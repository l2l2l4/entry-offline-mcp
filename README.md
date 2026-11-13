# entry-offline-mcp

**Claude Code, Codex** 같은 AI 에이전트가 내 PC에 설치된 **엔트리 오프라인**(Entry, playentry.org)을 직접 조작해서
**블록코딩 / 엔트리파이썬 작품**을 만들 수 있게 해 주는 MCP 서버입니다.

오브젝트 추가(라이브러리 2천여 개 스프라이트·배경·소리 검색), 직접 그린 이미지 업로드, 엔트리파이썬 → 블록 변환,
블록 JSON 작성, 변수·리스트·신호·함수, 장면, 실행·키 입력·스크린샷으로 테스트, `.ent` 저장/열기까지 지원합니다.
작업은 **실제 엔트리 창에서 실시간으로** 보입니다.

> An MCP server that lets AI agents (Claude, Codex, ...) build Entry (Korean block-coding platform) projects by driving the locally installed Entry offline app (Windows).

## 요구 사항
- Windows 10/11
- 엔트리 오프라인 설치 (playentry.org → 다운로드) (테스트 버전: 2.1.36)
- [Node.js](https://nodejs.org) **22 이상**
- Git (npx가 GitHub에서 받을 때 사용)

## 설치

> 가장 쉬운 방법: Claude Code나 Codex에게 **"https://github.com/l2l2l4/entry-offline-mcp 이 MCP 설치해줘"** 라고 부탁하세요. 설치 후에는 새 대화(세션)를 열어야 엔트리 도구가 보입니다.

### Claude Code
**명령 프롬프트(cmd)**
```bat
claude mcp add -s user entry -- cmd /c npx -y github:l2l2l4/entry-offline-mcp
```
**PowerShell** (`--`를 따옴표로 감싸야 합니다)
```powershell
claude mcp add -s user entry '--' cmd /c npx -y github:l2l2l4/entry-offline-mcp
```
> Git Bash에서는 `/c`가 경로로 바뀌어 버리므로 cmd 또는 PowerShell에서 실행하세요.
> 첫 실행은 다운로드 때문에 시간이 걸릴 수 있습니다. `claude mcp list`에서 `Connected`가 보이면 완료.

제거: `claude mcp remove entry -s user`

### Codex (앱 / CLI)
`%USERPROFILE%\.codex\config.toml` 맨 끝에 추가하고 Codex를 다시 시작하세요.
```toml
[mcp_servers.entry]
command = 'cmd'
args = ['/c', 'npx', '-y', 'github:l2l2l4/entry-offline-mcp']
startup_timeout_sec = 120
```

### Claude Desktop 등 다른 MCP 클라이언트
```json
{
  "mcpServers": {
    "entry": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "github:l2l2l4/entry-offline-mcp"]
    }
  }
}
```

### 직접 받아서 쓰기
```bat
git clone https://github.com/l2l2l4/entry-offline-mcp
cd entry-offline-mcp
npm install
claude mcp add -s user entry -- node "%CD%\src\index.js"
```
Codex는 `config.toml`에 `command = 'node'`, `args = ['<받은 폴더>\src\index.js']`로 등록합니다.

> 같은 엔트리 창을 두 에이전트(예: Claude와 Codex)가 **동시에** 조작하면 꼬이므로 한 번에 하나만 사용하세요.

## 사용법
에이전트에게 그냥 부탁하면 됩니다.
- "엔트리로 별 피하기 게임 만들어줘"
- "엔트리파이썬으로 레이캐스팅 3D 미로 만들어줘"
- "방금 만든 작품 실행해서 테스트하고 저장해줘"

에이전트는 먼저 `entry_guide` 도구로 사용 설명서([GUIDE.md](GUIDE.md))를 읽고 작업합니다.

- MCP가 엔트리를 **원격 디버깅 포트를 켠 상태로** 실행해야 조작할 수 있습니다. 엔트리를 직접 켜 둔 상태라면 `entry_launch(restart=true)`로 다시 실행합니다(저장 안 된 작업은 미리 저장하세요).
- 작업하는 동안 엔트리 창을 직접 클릭/편집하면 서로 꼬일 수 있으니 지켜보기만 하세요.
- 처음 실행할 때 작업 폴더 `문서\EntryMCP\`(projects / images / sounds / screenshots / json)를 자동으로 만듭니다.

## 도구 목록
| 분류 | 도구 |
|---|---|
| 시작/상태 | `entry_guide`, `entry_launch`, `entry_status`, `entry_logs` |
| 작품 | `entry_project`(새로/열기/저장/이름/JSON), `entry_get_project`, `entry_scene` |
| 오브젝트 | `entry_search_assets`, `entry_preview_assets`, `entry_add_object`, `entry_update_object`, `entry_object_op`, `entry_object_assets` |
| 코드 | `entry_set_script`(파이썬/블록), `entry_get_script`, `entry_define_function`, `entry_data`, `entry_block_reference`, `entry_set_coding_mode` |
| 실행/검증 | `entry_run`, `entry_input`(키·마우스·대답), `entry_screenshot`, `entry_runtime_state` |
| 고급 | `entry_eval_js` |

## 환경변수 (선택)
| 변수 | 기본값 | 설명 |
|---|---|---|
| `ENTRY_PATH` | `C:\entry\Entry.exe` 등 자동 탐색 | 엔트리 실행 파일 경로 |
| `ENTRY_DEBUG_PORT` | `9333` | 원격 디버깅 포트 |
| `ENTRY_MCP_HOME` | `문서\EntryMCP` | 작업 폴더 |
| `ENTRY_ASAR` | 엔트리 폴더의 `resources\app.asar` | 내장 리소스 DB 위치 |

예: `claude mcp add -s user entry -e ENTRY_PATH="D:\Entry\Entry.exe" -- cmd /c npx -y github:l2l2l4/entry-offline-mcp`

## 동작 방식
```
Claude ⇄ (MCP, stdio) ⇄ entry-offline-mcp ⇄ (Chrome DevTools Protocol) ⇄ 엔트리 오프라인(Electron)
```
- `src/index.js` MCP 도구 · `src/cdp.js` DevTools 연결 · `src/bridge.js` 엔트리 안에 주입되는 헬퍼 · `src/assets.js` 내장 리소스 검색 · `src/launcher.js` 실행

엔트리 내부 API를 사용하므로 엔트리 버전이 바뀌면 일부 기능이 동작하지 않을 수 있습니다.
엔트리 프로그램/리소스는 포함하지 않으며, 사용자 PC에 설치된 엔트리를 그대로 사용합니다.
이 프로젝트는 엔트리(커넥트재단)와 관련 없는 비공식 프로젝트입니다.

## 라이선스
MIT
