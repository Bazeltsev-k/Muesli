import AVFoundation
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: obj)
    print(String(data: data, encoding: .utf8)!)
}

func log(_ message: String) {
    FileHandle.standardError.write("\(Date()) \(message)\n".data(using: .utf8)!)
}

func fail(_ message: String) -> Never {
    log("error: \(message)")
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

func transportType(_ id: AudioObjectID) -> UInt32 {
    var addr = address(kAudioDevicePropertyTransportType)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value)
    return value
}

func deviceID(_ uid: String) -> AudioObjectID? {
    var addr = address(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size)
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids)
    return ids.first { stringProperty($0, kAudioDevicePropertyDeviceUID) == uid }
}

func preferredDefaultInput() -> String? {
    guard let uid = defaultInputUID(), let id = deviceID(uid) else { return defaultInputUID() }
    let bluetooth = [kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE].contains(transportType(id))
    guard bluetooth else { return uid }
    return inputDevices().compactMap { $0["id"] }.first { deviceID($0).map { transportType($0) == kAudioDeviceTransportTypeBuiltIn } ?? false } ?? uid
}

func defaultInputUID() -> String? {
    var addr = address(kAudioHardwarePropertyDefaultInputDevice)
    var id = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr else { return nil }
    return stringProperty(id, kAudioDevicePropertyDeviceUID)
}

func inputDevices() -> [[String: String]] {
    var addr = address(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size)
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids)
    return ids.compactMap { id in
        guard inputChannels(id).reduce(0, +) > 0,
              let uid = stringProperty(id, kAudioDevicePropertyDeviceUID),
              let name = stringProperty(id, kAudioObjectPropertyName) else { return nil }
        return ["id": uid, "name": name]
    }
}

func listDevices() {
    let data = try! JSONSerialization.data(withJSONObject: inputDevices())
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
    var callbacks = 0
    var logMic: Float = 0
    var logSys: Float = 0
    var logFrames = 0
    var logZeros = 0

    init(dir: URL, micUID: String?, system: Bool) {
        self.dir = dir
        let rawURL = dir.appendingPathComponent("raw.pcm")
        FileManager.default.createFile(atPath: rawURL.path, contents: nil)
        raw = try! FileHandle(forWritingTo: rawURL)

        let available = Set(inputDevices().compactMap { $0["id"] })
        guard let mic = micUID.flatMap({ available.contains($0) ? $0 : nil }) ?? preferredDefaultInput() else { fail("No input device") }
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
            desc[kAudioAggregateDeviceTapAutoStartKey] = false
            desc[kAudioAggregateDeviceTapListKey] = [[kAudioSubTapUIDKey: tap.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]]
        }
        check(AudioHardwareCreateAggregateDevice(desc as CFDictionary, &aggID), "Creating aggregate device")

        var addr = address(kAudioDevicePropertyNominalSampleRate)
        var size = UInt32(MemoryLayout<Double>.size)
        AudioObjectGetPropertyData(aggID, &addr, 0, nil, &size, &rate)
        if let micID = deviceID(mic) {
            var busy: UInt32 = 0
            var busyAddr = address(kAudioDevicePropertyDeviceIsRunningSomewhere)
            var busySize = UInt32(MemoryLayout<UInt32>.size)
            AudioObjectGetPropertyData(micID, &busyAddr, 0, nil, &busySize, &busy)
            let fourcc = withUnsafeBytes(of: transportType(micID).bigEndian) { String(decoding: $0, as: UTF8.self) }
            log("mic transport=\(fourcc) inUseElsewhere=\(busy) default=\(defaultInputUID() ?? "none")")
        }
        log("mic=\(mic) system=\(system) aggregate=\(aggID) tap=\(tapID) rate=\(rate) inputStreams=\(inputChannels(aggID))")
        let meta = try! JSONSerialization.data(withJSONObject: ["rate": rate])
        try! meta.write(to: dir.appendingPathComponent("raw.json"))

        let hasTap = system
        check(AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, queue) { [unowned self] _, input, _, _, _ in
            let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
            callbacks += 1
            if callbacks <= 3 {
                log("callback \(callbacks): " + buffers.map { "\($0.mNumberChannels)ch \($0.mDataByteSize)B data=\($0.mData != nil)" }.joined(separator: ", "))
            }
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
                var m: Float = 0
                for c in 0..<micStride { m += mic[i * micStride + c] }
                m /= Float(micStride)
                let s = sys?[i * sysStride] ?? 0
                out[i * 2] = Int16(max(-1, min(1, m)) * 32767)
                out[i * 2 + 1] = Int16(max(-1, min(1, s)) * 32767)
                micSum += m * m
                sysSum += s * s
                logMic += m * m
                logSys += s * s
                if m == 0 { logZeros += 1 }
            }
            logFrames += count
            out.withUnsafeBytes { raw.write(Data($0)) }
            frames += count
            levelFrames += count
            if Double(logFrames) >= rate * 10 {
                log(String(format: "t=%ds mic=%.5f sys=%.5f micZeros=%d", frames / Int(rate), sqrt(logMic / Float(logFrames)), sqrt(logSys / Float(logFrames)), logZeros))
                logMic = 0
                logSys = 0
                logFrames = 0
                logZeros = 0
            }
            if Double(levelFrames) >= rate / 10 {
                emit(["type": "level", "mic": sqrt(micSum / Float(levelFrames)), "sys": sqrt(sysSum / Float(levelFrames)), "ms": frames * 1000 / Int(rate)])
                micSum = 0
                sysSum = 0
                levelFrames = 0
            }
        }, "Creating IO proc")
        check(AudioDeviceStart(aggID, procID), "Starting audio device")
        var running: UInt32 = 0
        var runningAddr = address(kAudioDevicePropertyDeviceIsRunning)
        var runningSize = UInt32(MemoryLayout<UInt32>.size)
        AudioObjectGetPropertyData(aggID, &runningAddr, 0, nil, &runningSize, &running)
        log("started running=\(running)")
        emit(["type": "started", "rate": rate])
    }

    func setPaused(_ value: Bool) {
        queue.sync { paused = value }
    }

    func stop() {
        AudioDeviceStop(aggID, procID)
        queue.sync {}
        log("stopped callbacks=\(callbacks) frames=\(frames)")
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
        let outRate = min(rate, 48000)
        var settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: outRate, AVNumberOfChannelsKey: 2]
        if outRate >= 32000 { settings[AVEncoderBitRateKey] = 96000 }
        let tmpURL = dir.appendingPathComponent("audio.tmp.m4a")
        try? FileManager.default.removeItem(at: tmpURL)
        do {
            let out = try AVAudioFile(forWriting: tmpURL, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
            let input = try FileHandle(forReadingFrom: rawURL)
            let chunk = 16384
            let source = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
            guard let converter = AVAudioConverter(from: source, to: out.processingFormat) else { fail("Unsupported sample rate \(rate)") }
            let inBuffer = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(chunk))!
            let outBuffer = AVAudioPCMBuffer(pcmFormat: out.processingFormat, frameCapacity: AVAudioFrameCount(chunk))!
            var finished = false
            while true {
                var error: NSError?
                let status = converter.convert(to: outBuffer, error: &error) { _, inputStatus in
                    guard !finished, let data = try? input.read(upToCount: chunk * 4), !data.isEmpty else {
                        finished = true
                        inputStatus.pointee = .endOfStream
                        return nil
                    }
                    let n = data.count / 4
                    data.withUnsafeBytes { bytes in
                        let samples = bytes.bindMemory(to: Int16.self)
                        for i in 0..<n {
                            inBuffer.floatChannelData![0][i] = Float(samples[i * 2]) / 32768
                            inBuffer.floatChannelData![1][i] = Float(samples[i * 2 + 1]) / 32768
                        }
                    }
                    inBuffer.frameLength = AVAudioFrameCount(n)
                    inputStatus.pointee = .haveData
                    return inBuffer
                }
                if let error { throw error }
                if outBuffer.frameLength > 0 { try out.write(from: outBuffer) }
                if status == .endOfStream || status == .error { break }
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

func record(_ dir: URL, micUID: String?, system: Bool) -> Never {
    var noRunLoop: CFRunLoop?
    var runLoopAddr = address(kAudioHardwarePropertyRunLoop)
    AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &runLoopAddr, 0, nil, UInt32(MemoryLayout<CFRunLoop?>.size), &noRunLoop)
    let recorder = Recorder(dir: dir, micUID: micUID, system: system)
    Thread.detachNewThread {
        while let line = readLine() {
            let command = line.trimmingCharacters(in: .whitespaces)
            if command == "pause" { recorder.setPaused(true) }
            if command == "resume" { recorder.setPaused(false) }
            if command == "stop" { break }
        }
        recorder.stop()
        finalize(dir)
        exit(0)
    }
    RunLoop.main.run()
    exit(0)
}

func levelGains(_ file: AVAudioFile) throws -> [[Float]] {
    let format = file.processingFormat
    let frame = AVAudioFrameCount(format.sampleRate * 0.03)
    let block = 333
    let channels = Int(format.channelCount)
    var rms = [[Float]](repeating: [], count: channels)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frame)!
    file.framePosition = 0
    while file.framePosition < file.length {
        try file.read(into: buffer, frameCount: frame)
        let n = Int(buffer.frameLength)
        if n == 0 { break }
        for c in 0..<channels {
            var sum: Float = 0
            for i in 0..<n { sum += buffer.floatChannelData![c][i] * buffer.floatChannelData![c][i] }
            rms[c].append(sqrt(sum / Float(n)))
        }
    }
    file.framePosition = 0
    return rms.map { frames in
        stride(from: 0, to: frames.count, by: block).map { start in
            let sorted = frames[start..<min(frames.count, start + block)].sorted()
            let low = sorted[sorted.count / 5]
            let high = sorted[sorted.count * 49 / 50]
            return high >= 0.0008 && high > low * 4 ? min(30, max(1, 0.05 / high)) : 1
        }
    }
}

func mixdown(_ input: URL, _ output: URL) {
    do {
        let file = try AVAudioFile(forReading: input)
        let format = file.processingFormat
        let rate = format.sampleRate
        let gains = try levelGains(file)
        let blockFrames = Double(Int(rate * 0.03) * 333)
        var settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 2]
        if rate >= 32000 { settings[AVEncoderBitRateKey] = 96000 }
        let tmp = output.deletingLastPathComponent().appendingPathComponent("playback.tmp.m4a")
        try? FileManager.default.removeItem(at: tmp)
        let out = try AVAudioFile(forWriting: tmp, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let inBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16384)!
        let outBuffer = AVAudioPCMBuffer(pcmFormat: out.processingFormat, frameCapacity: 16384)!
        let channels = Int(format.channelCount)
        var position = 0
        while file.framePosition < file.length {
            try file.read(into: inBuffer, frameCount: AVAudioFrameCount(min(16384, file.length - file.framePosition)))
            let n = Int(inBuffer.frameLength)
            if n == 0 { break }
            for i in 0..<n {
                let pos = max(0, Double(position + i) / blockFrames - 0.5)
                var sum: Float = 0
                for c in 0..<channels {
                    let g = gains[c]
                    let k = min(Int(pos), g.count - 1)
                    let next = g[min(k + 1, g.count - 1)]
                    let gain = g[k] + (next - g[k]) * Float(min(1, pos - Double(k)))
                    sum += inBuffer.floatChannelData![c][i] * gain
                }
                let v = max(-1, min(1, sum))
                outBuffer.floatChannelData![0][i] = v
                outBuffer.floatChannelData![1][i] = v
            }
            position += n
            outBuffer.frameLength = AVAudioFrameCount(n)
            try out.write(from: outBuffer)
        }
        try? FileManager.default.removeItem(at: output)
        try FileManager.default.moveItem(at: tmp, to: output)
        emit(["type": "done"])
    } catch {
        fail("Preparing playback failed: \(error.localizedDescription)")
    }
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

func splice(_ output: URL, _ specURL: URL) {
    do {
        guard let spec = try JSONSerialization.jsonObject(with: Data(contentsOf: specURL)) as? [[String: Any]] else { fail("Bad splice spec") }
        var rate: Double = 48000
        if let first = spec.compactMap({ $0["file"] as? String }).first {
            rate = try AVAudioFile(forReading: URL(fileURLWithPath: first)).processingFormat.sampleRate
        }
        var settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 2]
        if rate >= 32000 { settings[AVEncoderBitRateKey] = 96000 }
        let tmp = output.deletingPathExtension().appendingPathExtension("tmp.m4a")
        try? FileManager.default.removeItem(at: tmp)
        let out = try AVAudioFile(forWriting: tmp, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let format = out.processingFormat
        let chunk: AVAudioFrameCount = 16384
        let outBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk * 4)!
        var written = 0
        for piece in spec {
            if let ms = piece["silence"] as? Double {
                var left = AVAudioFrameCount(ms / 1000 * rate)
                while left > 0 {
                    let n = min(left, outBuffer.frameCapacity)
                    for c in 0..<Int(format.channelCount) { memset(outBuffer.floatChannelData![c], 0, Int(n) * 4) }
                    outBuffer.frameLength = n
                    try out.write(from: outBuffer)
                    written += Int(n)
                    left -= n
                }
                continue
            }
            guard let path = piece["file"] as? String, let startMs = piece["start"] as? Double, let endMs = piece["end"] as? Double else { fail("Bad splice piece") }
            let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
            let inFormat = file.processingFormat
            let fileRate = inFormat.sampleRate
            let end = min(file.length, AVAudioFramePosition(endMs / 1000 * fileRate))
            file.framePosition = min(end, max(0, AVAudioFramePosition(startMs / 1000 * fileRate)))
            let inBuffer = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: chunk)!
            let converter = inFormat == format ? nil : AVAudioConverter(from: inFormat, to: format)
            while file.framePosition < end {
                try file.read(into: inBuffer, frameCount: AVAudioFrameCount(min(AVAudioFramePosition(chunk), end - file.framePosition)))
                if inBuffer.frameLength == 0 { break }
                guard let converter else {
                    try out.write(from: inBuffer)
                    written += Int(inBuffer.frameLength)
                    continue
                }
                var fed = false
                var error: NSError?
                converter.convert(to: outBuffer, error: &error) { _, status in
                    if fed {
                        status.pointee = .noDataNow
                        return nil
                    }
                    fed = true
                    status.pointee = .haveData
                    return inBuffer
                }
                if let error { throw error }
                if outBuffer.frameLength > 0 {
                    try out.write(from: outBuffer)
                    written += Int(outBuffer.frameLength)
                }
            }
        }
        try? FileManager.default.removeItem(at: output)
        try FileManager.default.moveItem(at: tmp, to: output)
        emit(["type": "done", "ms": Int((Double(written) * 1000 / rate).rounded())])
    } catch {
        fail("Moving audio failed: \(error.localizedDescription)")
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
case "mixdown" where args.count > 3:
    mixdown(URL(fileURLWithPath: args[2]), URL(fileURLWithPath: args[3]))
case "splice" where args.count > 3:
    splice(URL(fileURLWithPath: args[2]), URL(fileURLWithPath: args[3]))
case "decode" where args.count > 3:
    decode(URL(fileURLWithPath: args[2]), URL(fileURLWithPath: args[3]))
default:
    fail("usage: muesli-recorder devices|permissions|request <kind>|record <dir> [--mic uid] [--no-system]|finalize <dir>|decode <in> <out>|mixdown <in> <out>|splice <out> <spec.json>")
}
