# 驗證紀錄

日期：2026-09-10。平台：Windows，Node.js 26.4.0。

## 自動測試

執行 `node --test`：**16 / 16 通過**。

覆蓋 metadata 解析（包括 Vercel 實際使用嘅分行格式）、關鍵字排序、本機目錄同 symlink 去重、離線零網絡要求、名稱重疊、來源局部失敗、逾時、錯誤資料脫敏、非法參數及 CLI exit code。

呢啲測試驗證程式行為；唔代表完成第三方 skills 安全審核，亦唔證明 agent 每次都會遵從任務前指引。

## 真實 GitHub metadata 測試

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
- 未喺用戶專案安裝 Scout、修改 `AGENTS.md`、安裝第三方 skills，亦未驗證新 agent 任務自動觸發。
- 專案預期支援 Node.js 22+；今次實際測試版本係 26.4.0，未喺 Linux/macOS 或其他 Node 版本執行。
- 系統 `quick_validate.py`：**Skill is valid!**。驗證時將 PyYAML 6.0.3 放入獨立臨時目錄，Python 使用 UTF-8 模式；冇修改全域 Python 或加入專案 runtime dependency。

觸發方式依賴 host 指引載入；搜尋工具唔係 runtime hook。使用者需要先安裝 Scout，同將附帶段落合併到目標專案指引，再喺新任務檢查載入情況。
