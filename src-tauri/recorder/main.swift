import AVFoundation
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: obj)
    print(String(data: data, encoding: .utf8)!)
}

func fail(_ message: String) -> Never {
    emit(["type": "error", "message": message])
    exit(1)
}

func check(_ status: OSStatus, _ what: String) {
    if status != noErr { fail("\(what) failed (\(status))") }
}

func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func stringProperty(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = address(selector)
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var value: Unmanaged<CFString>?
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr, let value else { return nil }
    return value.takeRetainedValue() as String
}

func inputChannels(_ id: AudioObjectID) -> [UInt32] {
    var addr = address(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, raw) == noErr else { return [] }
    return UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self)).map { $0.mNumberChannels }
}

func defaultInputUID() -> String? {
    var addr = address(kAudioHardwarePropertyDefaultInputDevice)
    var id = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr else { return nil }
    return stringProperty(id, kAudioDevicePropertyDeviceUID)
}

func listDevices() {
    var addr = address(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size)
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids)
    let devices: [[String: Any]] = ids.compactMap { id in
        guard inputChannels(id).reduce(0, +) > 0,
              let uid = stringProperty(id, kAudioDevicePropertyDeviceUID),
              let name = stringProperty(id, kAudioObjectPropertyName) else { return nil }
        return ["id": uid, "name": name]
    }
    let data = try! JSONSerialization.data(withJSONObject: devices)
    print(String(data: data, encoding: .utf8)!)
}

typealias TCCPreflight = @convention(c) (CFString, CFDictionary?) -> Int
typealias TCCRequest = @convention(c) (CFString, CFDictionary?, @escaping @convention(block) (Bool) -> Void) -> Void
let tcc = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW)

func systemAudioStatus() -> String {
    guard let sym = dlsym(tcc, "TCCAccessPreflight") else { return "unknown" }
    switch unsafeBitCast(sym, to: TCCPreflight.self)("kTCCServiceAudioCapture" as CFString, nil) {
    case 0: return "granted"
    case 1: return "denied"
    default: return "undetermined"
    }
}

func micStatus() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .denied, .restricted: return "denied"
    default: return "undetermined"
    }
}

func printPermissions() {
    emit(["microphone": micStatus(), "systemAudio": systemAudioStatus()])
}

func request(_ kind: String) {
    let done = DispatchSemaphore(value: 0)
    if kind == "microphone" {
        AVCaptureDevice.requestAccess(for: .audio) { _ in done.signal() }
    } else if let sym = dlsym(tcc, "TCCAccessRequest") {
        unsafeBitCast(sym, to: TCCRequest.self)("kTCCServiceAudioCapture" as CFString, nil) { _ in done.signal() }
    } else {
        done.signal()
    }
    done.wait()
    printPermissions()
}

final class Recorder {
    let dir: URL
    let raw: FileHandle
    var tapID = AudioObjectID(kAudioObjectUnknown)
    var aggID = AudioObjectID(kAudioObjectUnknown)
    var procID: AudioDeviceIOProcID?
    let queue = DispatchQueue(label: "muesli.io")
    var rate: Double = 48000
    var frames = 0
    var paused = false
    var micSum: Float = 0
    var sysSum: Float = 0
    var levelFrames = 0

    init(dir: URL, micUID: String?, system: Bool) {
        self.dir = dir
        let rawURL = dir.appendingPathComponent("raw.pcm")
        FileManager.default.createFile(atPath: rawURL.path, contents: nil)
        raw = try! FileHandle(forWritingTo: rawURL)

        guard let mic = micUID ?? defaultInputUID() else { fail("No input device") }
        var desc: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Muesli Recorder",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: mic,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: mic]],
        ]
        if system {
            let tap = CATapDescription(monoGlobalTapButExcludeProcesses: [])
            tap.uuid = UUID()
            tap.muteBehavior = .unmuted
            tap.isPrivate = true
            tap.name = "Muesli System Audio"
            check(AudioHardwareCreateProcessTap(tap, &tapID), "Creating system audio tap")
            desc[kAudioAggregateDeviceTapAutoStartKey] = true
            desc[kAudioAggregateDeviceTapListKey] = [[kAudioSubTapUIDKey: tap.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]]
        }
        check(AudioHardwareCreateAggregateDevice(desc as CFDictionary, &aggID), "Creating aggregate device")

        var addr = address(kAudioDevicePropertyNominalSampleRate)
        var size = UInt32(MemoryLayout<Double>.size)
        AudioObjectGetPropertyData(aggID, &addr, 0, nil, &size, &rate)
        let meta = try! JSONSerialization.data(withJSONObject: ["rate": rate])
        try! meta.write(to: dir.appendingPathComponent("raw.json"))

        let hasTap = system
        check(AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, queue) { [unowned self] _, input, _, _, _ in
            let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
            guard !paused, let micBuf = buffers.first, let micData = micBuf.mData else { return }
            let micStride = Int(max(micBuf.mNumberChannels, 1))
            let count = Int(micBuf.mDataByteSize) / (4 * micStride)
            let mic = micData.assumingMemoryBound(to: Float.self)
            var sys: UnsafeMutablePointer<Float>?
            var sysStride = 1
            if hasTap, buffers.count > 1, let last = buffers.last, let data = last.mData {
                sys = data.assumingMemoryBound(to: Float.self)
                sysStride = Int(max(last.mNumberChannels, 1))
            }
            var out = [Int16](repeating: 0, count: count * 2)
            for i in 0..<count {
                let m = mic[i * micStride]
                let s = sys?[i * sysStride] ?? 0
                out[i * 2] = Int16(max(-1, min(1, m)) * 32767)
                out[i * 2 + 1] = Int16(max(-1, min(1, s)) * 32767)
                micSum += m * m
                sysSum += s * s
            }
            out.withUnsafeBytes { raw.write(Data($0)) }
            frames += count
            levelFrames += count
            if Double(levelFrames) >= rate / 10 {
                emit(["type": "level", "mic": sqrt(micSum / Float(levelFrames)), "sys": sqrt(sysSum / Float(levelFrames)), "ms": frames * 1000 / Int(rate)])
                micSum = 0
                sysSum = 0
                levelFrames = 0
            }
        }, "Creating IO proc")
        check(AudioDeviceStart(aggID, procID), "Starting audio device")
        emit(["type": "started", "rate": rate])
    }

    func setPaused(_ value: Bool) {
        queue.sync { paused = value }
    }

    func stop() {
        AudioDeviceStop(aggID, procID)
        queue.sync {}
        if let procID { AudioDeviceDestroyIOProcID(aggID, procID) }
        AudioHardwareDestroyAggregateDevice(aggID)
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        try? raw.close()
    }
}

func finalize(_ dir: URL) {
    let rawURL = dir.appendingPathComponent("raw.pcm")
    let outURL = dir.appendingPathComponent("audio.m4a")
    if FileManager.default.fileExists(atPath: rawURL.path) {
        guard let metaData = try? Data(contentsOf: dir.appendingPathComponent("raw.json")),
              let meta = try? JSONSerialization.jsonObject(with: metaData) as? [String: Double],
              let rate = meta["rate"] else { fail("Missing raw.json") }
        var settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 2]
        if rate >= 32000 { settings[AVEncoderBitRateKey] = 96000 }
        let tmpURL = dir.appendingPathComponent("audio.tmp.m4a")
        try? FileManager.default.removeItem(at: tmpURL)
        do {
            let out = try AVAudioFile(forWriting: tmpURL, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
            let input = try FileHandle(forReadingFrom: rawURL)
            let chunk = 16384
            let buffer = AVAudioPCMBuffer(pcmFormat: out.processingFormat, frameCapacity: AVAudioFrameCount(chunk))!
            while let data = try input.read(upToCount: chunk * 4), !data.isEmpty {
                let n = data.count / 4
                data.withUnsafeBytes { bytes in
                    let samples = bytes.bindMemory(to: Int16.self)
                    for i in 0..<n {
                        buffer.floatChannelData![0][i] = Float(samples[i * 2]) / 32768
                        buffer.floatChannelData![1][i] = Float(samples[i * 2 + 1]) / 32768
                    }
                }
                buffer.frameLength = AVAudioFrameCount(n)
                try out.write(from: buffer)
            }
        } catch {
            fail("Encoding audio failed: \(error.localizedDescription)")
        }
        try? FileManager.default.removeItem(at: outURL)
        try! FileManager.default.moveItem(at: tmpURL, to: outURL)
        try? FileManager.default.removeItem(at: rawURL)
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("raw.json"))
    }
    guard let file = try? AVAudioFile(forReading: outURL) else { fail("No audio recorded") }
    emit(["type": "done", "ms": Int(Double(file.length) * 1000 / file.fileFormat.sampleRate)])
}

func record(_ dir: URL, micUID: String?, system: Bool) {
    let recorder = Recorder(dir: dir, micUID: micUID, system: system)
    while let line = readLine() {
        let command = line.trimmingCharacters(in: .whitespaces)
        if command == "pause" { recorder.setPaused(true) }
        if command == "resume" { recorder.setPaused(false) }
        if command == "stop" { break }
    }
    recorder.stop()
    finalize(dir)
}

func decode(_ input: URL, _ output: URL) {
    do {
        let file = try AVAudioFile(forReading: input)
        let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 2, interleaved: true)!
        let source = AVAudioFormat(standardFormatWithSampleRate: file.processingFormat.sampleRate, channels: 2)!
        guard let converter = AVAudioConverter(from: source, to: target) else { fail("Unsupported audio format") }
        FileManager.default.createFile(atPath: output.path, contents: nil)
        let out = try FileHandle(forWritingTo: output)
        let inBuffer = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: 32768)!
        let outBuffer = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: 16384)!
        var finished = false
        while true {
            var error: NSError?
            let status = converter.convert(to: outBuffer, error: &error) { _, inputStatus in
                if finished { inputStatus.pointee = .endOfStream; return nil }
                do { try file.read(into: inBuffer) } catch { finished = true }
                if inBuffer.frameLength == 0 { finished = true; inputStatus.pointee = .endOfStream; return nil }
                inputStatus.pointee = .haveData
                return inBuffer
            }
            if let error { throw error }
            if outBuffer.frameLength > 0 {
                out.write(Data(bytes: outBuffer.floatChannelData![0], count: Int(outBuffer.frameLength) * 8))
            }
            if status == .endOfStream || status == .error { break }
        }
        try out.close()
        emit(["type": "done"])
    } catch {
        fail("Decoding failed: \(error.localizedDescription)")
    }
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "devices":
    listDevices()
case "permissions":
    printPermissions()
case "request" where args.count > 2:
    request(args[2])
case "record" where args.count > 2:
    let mic = args.firstIndex(of: "--mic").map { args[$0 + 1] }
    record(URL(fileURLWithPath: args[2]), micUID: mic, system: !args.contains("--no-system"))
case "finalize" where args.count > 2:
    finalize(URL(fileURLWithPath: args[2]))
case "decode" where args.count > 3:
    decode(URL(fileURLWithPath: args[2]), URL(fileURLWithPath: args[3]))
default:
    fail("usage: muesli-recorder devices|permissions|request <kind>|record <dir> [--mic uid] [--no-system]|finalize <dir>|decode <in> <out>")
}
