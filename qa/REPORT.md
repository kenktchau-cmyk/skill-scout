# 驗證紀錄

日期：2026-09-10。平台：Windows，Node.js 26.4.0。

## 自動測試

v0.2.0 執行 `node --test`：**21 / 21 通過**（最初只有 Skill 搜尋嘅 v0.1.0 為 16 / 16）。

覆蓋 metadata 解析（包括 Vercel 實際使用嘅分行格式）、關鍵字排序、本機目錄同 symlink 去重、離線零網絡要求、名稱重疊、來源局部失敗、逾時、錯誤資料脫敏、非法參數及 CLI exit code。擴充測試涵蓋三類搜尋整合、Plugin manifest、MCP 版本去重／非 active 狀態／分頁、未知連線狀態，以及憑證只發往 GitHub、候選 endpoint 不會被呼叫。

呢啲測試驗證程式行為；唔代表完成第三方 skills 安全審核，亦唔證明 agent 每次都會遵從任務前指引。

## 最初 Skill 搜尋嘅真實 GitHub 測試

2026-09-10 13:25:43 UTC（香港 21:25:43）執行：

```bash
node skills/skill-scout/scripts/scout.mjs --query "pdf forms react" --root ./skills --timeout-ms 15000
```

| 倉庫 | 狀態 | 已讀候選 metadata |
| --- | --- | --- |
| openai/skills | ok | 1 |
| anthropics/skills | ok | 1 |
| vercel-labs/agent-skills | ok | 3 |

CLI 返回三個排前嘅候選，全部標示為 `unreviewed`：

| Skill | 來源 | 當時讀取嘅 blob SHA |
| --- | --- | --- |
| pdf | anthropics/skills | `d3e046a5ae107a6cb23cfb16c219837094ab35d3` |
| pdf | openai/skills | `fd5d56058f10202e4f50a30bc2906f39696024a1` |
| vercel-react-best-practices | vercel-labs/agent-skills | `237988de4a66dd8a71d30a2c24ebe1a86b58d04e` |

一開始受執行環境網絡限制，三個來源都正確回報 `error`，程式正常結束。取得唯讀公開網絡測試許可後，三個來源全部成功。實測冇安裝候選或執行佢哋嘅 scripts。

另一次離線實測成功讀取本機三個用戶 skill 根目錄，合共 21 份 metadata；三個尚未安裝 Scout 嘅專案 skill 目錄正確回報 `missing`。本機絕對路徑同 metadata 內容冇寫入呢份報告。

## 驗證範圍

- 真實測試涵蓋公開 GitHub GET，冇測試私人倉庫 token。
- skills.sh 同 GitHub 搜尋連結未由 CLI 打開，結果正確標為 `not-searched`。Agent 使用搜尋／瀏覽工具補充搜尋嘅流程由 Skill 指引定義。
- v0.1.0 已按用戶指示安裝到 Codex 用戶 skills 目錄，五個檔案 hash 一致，並備份及保留既有 `AGENTS.md` 後加入任務前設定。擴充版本安裝結果另記於下方。未安裝任何搜尋到嘅第三方候選，亦未驗證新 agent 任務自動觸發。
- 專案預期支援 Node.js 22+；今次實際測試版本係 26.4.0，未喺 Linux/macOS 或其他 Node 版本執行。
- 系統 `quick_validate.py`：**Skill is valid!**。驗證時將 PyYAML 6.0.3 放入獨立臨時目錄，Python 使用 UTF-8 模式；冇修改全域 Python 或加入專案 runtime dependency。

觸發方式依賴 host 指引載入；搜尋工具唔係 runtime hook。使用者需要先安裝 Scout，同將附帶段落合併到目標專案指引，再喺新任務檢查載入情況。

## v0.2.0 MCP 及外掛真實來源測試

2026-09-10 14:01:25 UTC（香港 22:01:25），以 `github` 作公開關鍵字執行預設三類搜尋：

- 三個 Skill 倉庫成功讀取目錄；該字未匹配 Skill 資料夾名，回報零候選。呢個係名稱篩選限制，唔代表完全冇相關 Skill。
- `openai/plugins` 成功讀取 `github` 外掛 manifest，版本 `0.1.11`，標記 host 為 Codex、連線狀態未確認。
- 官方 MCP Registry 成功返回 19 個當頁去重後有效候選，有下一頁，因此正確標記 `partial`／`more-registry-pages`。結果全部係未評審線索；未連接任何 MCP endpoint。
- JSON schema 已升至 2，提供 Skill／MCP／Plugin 分組、未知連線狀態及逐來源覆蓋資訊。

MCP Registry 真實測試只提交 `github` 關鍵字。冇傳送本機設定或秘密，冇執行 Registry 內嘅套件、指令、headers 或外掛 hooks。Registry 名稱存在唔代表已完成安全評審。

v0.2.0 已更新到用戶 Codex skills 目錄：六個檔案與 repository 版本 SHA-256 一致。安裝後執行離線命令，返回 `schemaVersion: 2`，可找到 `skill-scout`。全域任務前指引只替換 Scout 自己嘅標記段落，其他指引保持一致，更新前已備份。
