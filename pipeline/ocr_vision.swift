import AppKit
import Foundation
import Vision

/* ==================================================
 * ocr_vision.swift - 政見影像的文字辨識
 * --------------------------------------------------
 * - 角色：以 macOS 的 Vision 辨識一張影像的文字，輸出每行文字、信心與位置
 * - 指令：swiftc -O pipeline/ocr_vision.swift -o .cache/tools/ocr_vision，再執行 ocr_vision <影像> <輸出 JSON>
 * - 慣例：座標換成左上角為原點、0 到 1 的比例，行依由上而下、由左而右排序
 * - 參見：pipeline/ocr.py 負責編譯、快取與呼叫
 * ================================================== */

/* ==================================================
 * 型別定義
 * ================================================== */

/// 一行辨識結果，座標為影像寬高的比例。
struct Line: Encodable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

/// 一張影像的辨識結果。
struct Output: Encodable {
    let engine: String
    let languages: [String]
    let lines: [Line]
}

/* ==================================================
 * 集中設定
 * ================================================== */

/// 辨識語言，正體中文優先
let LANGUAGES = ["zh-Hant", "en-US"]

/// 引擎名稱，寫進輸出供快取比對
let ENGINE = "apple-vision-accurate"

/* ==================================================
 * 主體
 * ================================================== */

/// 讀取影像並辨識，失敗時以結束代碼 1 結束並寫出原因。
func recognize(_ input: String) -> [Line] {
    // 影像讀不到時無法辨識
    guard let image = NSImage(contentsOfFile: input),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("讀不到影像 \(input)\n".data(using: .utf8)!)
        exit(1)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = LANGUAGES
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    // 辨識同步執行，失敗時以結束代碼 1 結束
    do {
        try handler.perform([request])
    } catch {
        // Vision 執行失敗時寫出原因
        FileHandle.standardError.write("辨識失敗：\(error)\n".data(using: .utf8)!)
        exit(1)
    }
    let observations = request.results ?? []
    // 每個觀測取信心最高的候選文字，座標翻成左上角為原點
    let lines = observations.compactMap { observation -> Line? in
        // 沒有候選文字的觀測略過
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return Line(text: candidate.string, confidence: candidate.confidence,
                    x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
    }
    // 由上而下、同一列由左而右
    return lines.sorted { a, b in abs(a.y - b.y) > 0.005 ? a.y < b.y : a.x < b.x }
}

/* ==================================================
 * 入口
 * ================================================== */

// 參數依序為影像與輸出檔
let arguments = CommandLine.arguments
// 參數個數不對時印出用法，結束代碼 2 與其他入口一致
if arguments.count != 3 {
    FileHandle.standardError.write("用法：ocr_vision <影像> <輸出 JSON>\n".data(using: .utf8)!)
    exit(2)
}
// 鍵排序輸出，同一張影像重新執行時內容相同
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let output = Output(engine: ENGINE, languages: LANGUAGES, lines: recognize(arguments[1]))
// 輸出檔由 pipeline/ocr.py 指定在快取目錄
let data = try! encoder.encode(output)
try! data.write(to: URL(fileURLWithPath: arguments[2]))
