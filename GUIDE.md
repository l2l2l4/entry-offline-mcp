# Entry MCP 가이드 (AI 에이전트용: Claude, Codex 등)

로컬에 설치된 **엔트리 오프라인 앱**을 직접 조작해 작품을 만든다. 블록 변환·파이썬 변환·실행·저장은 모두 엔트리 앱 자체 기능을 그대로 쓰므로, 결과물은 사람이 엔트리에서 만든 작품과 동일하다.

## 0. 작업 폴더 (MCP 첫 실행 시 자동 생성)
`문서\EntryMCP\` (환경변수 `ENTRY_MCP_HOME`으로 변경 가능)
- `projects\` 저장한 .ent / `images\` 사용할 이미지 / `sounds\` 사용할 소리 / `screenshots\` 캡처 / `json\` 내보낸 JSON
- 도구에 **상대경로**를 주면 이 폴더 기준. `entry_project save`는 path 생략 시 `projects\<작품이름>.ent`.
- 실제 경로는 `entry_status`의 `workspace`에서 확인.

## 1. 기본 작업 흐름
1. `entry_launch` → 연결 (작품 복구 대화상자가 뜨면 사용자에게 물어보고 recovery 지정)
2. `entry_project {action:"new", empty:true, name}` → 빈 작품 (현재 작품은 저장 안 하면 사라짐!)
3. 에셋: `entry_search_assets` → (`entry_preview_assets`로 눈으로 확인) → `entry_add_object`
   - 배경은 `kind:"background"`로 검색해서 추가 (자동으로 맨 뒤 + 잠금)
   - 글상자(`source:"textbox"`)로 제목/점수/안내문 UI 구성
4. 데이터: `entry_data`로 변수(초기값, 무대 표시 여부/위치), 리스트, 신호
5. 코드: `entry_set_script` (python 또는 blocks). **결과의 warnings를 반드시 확인.**
6. 검증: `entry_run` (스크린샷+상태) → `entry_input`(키/클릭/대답 입력) → `entry_runtime_state` → 문제 수정 반복
7. `entry_project {action:"save"}` → 저장. 최종 화면은 `entry_screenshot {save_as}`로 남길 수 있음.

## 2. 무대 / 좌표 / 속성
- 무대 480×270. x: -240(왼쪽)~240(오른쪽), y: -135(아래)~135(위). 중심 (0,0).
- `rotation`(방향) 기본 0 = 그림 원래 각도. `direction`(이동 방향) 기본 90 = 오른쪽, 0 = 위.
- `rotateMethod`: free(360°회전) / vertical(좌우 뒤집기만 – 좌우로 걷는 캐릭터에 적합) / none.
- `size` = 오브젝트 패널의 '크기' 값(%). 라이브러리 스프라이트는 원본이 커서 보통 30~80 정도로 줄여야 보기 좋다.
  모양마다 원본 크기가 다르면 모양을 바꿀 때 크기 값이 달라질 수 있음.
- `layer`: 0이 맨 앞. 배경은 맨 뒤.
- 실행(시작하기) 후 정지하면 오브젝트는 실행 전 상태로 되돌아간다. 초기 위치/모양은 `entry_update_object`로 정하거나 시작 스크립트에서 설정.
- 반복 블록은 **반복 한 번에 한 프레임(약 1/60초)** 진행된다. `while True:` 안에서 x를 6씩 바꾸면 초당 약 360px 이동.

## 3. 엔트리파이썬으로 코드 작성 (권장: 짧고 정확)
`entry_set_script {object, python}` – 엔트리 자체 변환기가 블록으로 바꾼다. `import Entry`는 생략 가능.
코드 안에 쓴 **변수/리스트/신호/함수는 자동 생성**된다 (초기값/표시여부는 entry_data로 따로 조정).

```python
점수 = 0            # 전역 변수 선언 (맨 위)
적목록 = []          # 리스트 선언

def 점프(높이):       # 사용자 함수 (일반 함수만, 반환값 없음)
    Entry.add_y(높이)

def when_start():                    # 시작하기 버튼
    Entry.set_xy(0, -90)
    while True:                      # 계속 반복
        if Entry.is_key_pressed("left"):
            Entry.add_x(-6)
        if Entry.is_touched("edge"):  # 벽 (블록 값 wall)
            Entry.bounce_on_edge()
        if Entry.is_touched("적"):    # 다른 오브젝트 이름
            Entry.send_signal("게임오버")
            Entry.stop_code("all")

def when_press_key("space"):          # 키: "a"~"z","0"~"9","space","enter","up","down","left","right"
    점수 += 1
    점프(30)

def when_get_signal("게임오버"):
    Entry.start_scene("게임오버 장면")

def when_make_clone():                # 복제본 생성 시
    Entry.set_x(random.randint(-200, 200))
    Entry.show()
```

### 이벤트 함수
| 파이썬 | 블록 |
|---|---|
| `def when_start():` | 시작하기 버튼 클릭 |
| `def when_press_key("a"):` | 키를 눌렀을 때 |
| `def when_click_mouse_on():` / `when_click_mouse_off()` | 마우스 클릭 / 해제 |
| `def when_click_object_on():` / `when_click_object_off()` | 이 오브젝트 클릭 / 해제 |
| `def when_get_signal("신호"):` | 신호를 받았을 때 |
| `def when_start_scene():` | 장면이 시작되었을 때 |
| `def when_make_clone():` | 복제본이 처음 생성되었을 때 |

### 자주 쓰는 명령 (모두 `Entry.` 접두)
- 흐름: `wait_for_sec(초)`, `for i in range(n):`, `while True:`, `while 조건:`, `break`, `wait_until(조건)`, `stop_code("all"|"self"|"this"|"others")`, `start_again()`
- 복제: `make_clone_of("self"|"오브젝트")`, `remove_this_clone()`, `remove_all_clone()`
- 움직임: `move_to_direction(n)`, `add_x(n)`, `add_y(n)`, `set_x(x)`, `set_y(y)`, `set_xy(x, y)`, `add_xy_for_sec(dx, dy, 초)`, `set_xy_for_sec(x, y, 초)`, `move_to("오브젝트"|"mouse_pointer")`, `move_to_for_sec("오브젝트", 초)`, `add_rotation(각)`, `set_rotation(각)`, `add_direction(각)`, `set_direction(각)`, `look_at("오브젝트"|"mouse_pointer")`, `move_to_degree(거리, 각도)`, `bounce_on_edge()`
- 생김새: `show()`, `hide()`, `print("말")`, `print_for_sec("말", 초)`, `clear_print()`, `change_shape("모양이름")`, `change_shape_to("next"|"prev")`, `add_effect("color"|"brightness"|"transparency", n)`, `set_effect(효과, n)`, `clear_effect()`, `add_size(n)`, `set_size(n)`, `flip_vertical()`(좌우), `flip_horizontal()`(상하), `send_layer_to("front"|"forward"|"backward"|"back")`
- 붓: `stamp()`, `start_drawing()`, `stop_drawing()`, `set_brush_color_to("#ff0000")`, `set_brush_size(n)`, `add_brush_size(n)`, `set_brush_color_to_random()`, `set_brush_transparency(n)`, `clear_drawing()`
- 글상자: `write_text(값)`, `append_text(값)`, `prepend_text(값)`, `clear_text()`, `contents_of_textbox("self")`
- 소리: `play_sound("소리이름")`, `play_sound_and_wait("소리")`, `play_sound_for_sec("소리", 초)`, `set_sound_volume(n)`, `stop_sound()`
- 판단: `is_key_pressed("space")`, `is_mouse_clicked()`, `is_touched("mouse_pointer"|"edge"|"edge_up"|"edge_down"|"edge_left"|"edge_right"|"오브젝트")`, 비교 `== != > < >= <=`, `and or not`
- 계산: `random.randint(a, b)`, `+ - * / %`, `//`, `Entry.value_of_mouse_pointer("x"|"y")`, `Entry.value_of_object("self"|"오브젝트", "x"|"y"|"size"|"rotation"|"direction"|"shape_number"|"shape_name")`, `Entry.value_of_distance_to("오브젝트"|"mouse_pointer")`, `Entry.value_of_timer()`, `Entry.timer("start"|"stop"|"reset")`, `Entry.timer_view("show"|"hide")`, `Entry.value_of_current_time("year"|"month"|"day"|"hour"|"minute"|"second")`, `len(문자열)`, `a + b`(문자 합치기), `s[i]`, `s[a:b]`, `s.find(x)`, `s.replace(a, b)`, `s.upper()`
- 자료: `변수 = 값`, `변수 += 값`, `Entry.input("질문")` + `Entry.answer()`, `Entry.answer_view("show"|"hide")`, `Entry.show_variable("변수명")`, `Entry.hide_variable("변수명")`, 리스트 `목록.append(x)`, `목록.pop(i)`, `목록.insert(i, x)`, `목록[i] = x`, `목록[i]`, `len(목록)`, `x in 목록`, `Entry.show_list("목록명")`
- 장면/신호: `Entry.send_signal("신호")`, `Entry.send_signal_wait("신호")`, `Entry.start_scene("장면")`, `Entry.start_scene_of("next"|"prev")`

### 엔트리파이썬 주의점
- **리스트/문자 인덱스는 0부터** (`목록[0]`이 첫 항목 → 블록의 1번째 항목으로 변환됨).
- 파이썬 이름 ≠ 블록 값인 것들: 마우스 = `"mouse_pointer"`, 벽 = `"edge"`, `stop_code("self")` = 자신의 코드, 모양 번호/이름 = `"shape_number"`/`"shape_name"`. 블록 값으로 잘못 쓰면 MCP가 자동 보정하고 warnings에 알려준다.
- 한 이벤트 함수는 하나의 블록 묶음(스레드). 같은 이벤트를 여러 개 정의해도 된다.
- 지원 안 되는 것: `continue`(블록 `continue_repeat`은 blocks로만), 값 반환 함수(`return`), 함수 지역변수 → 이런 건 `entry_define_function`(블록)으로 만든다. 파이썬에서 `def 함수(인자):`는 일반 함수만.
- **리스트 리터럴 `목록 = [1, 2]` 불가** → `entry_data {kind:"list", action:"add", items:[...]}`로 먼저 만들고 코드에선 `목록[i]`, `목록.append(x)`, `목록[i] = x`. (MCP가 감지해서 오류로 알려줌)
- 코드에서 대입(`이름 = 값`)하는 변수는 MCP가 미리 **숨김 전역 변수**로 만들어 둔다(함수 안에서 먼저 읽어도 OK). 무대에 보이게 하려면 `entry_data {action:"set", visible:true}`.
- 다른 오브젝트가 대입하는 변수를 읽기만 하는 스크립트는, 그 변수가 이미 있어야 한다 → 대입하는 오브젝트 스크립트를 먼저 설정. (없으면 엔트리가 변수를 문자열로 바꿔버리므로 MCP가 오류로 막음)
- 재귀 함수(자기 자신 호출)·뒤에 정의된 함수 호출 OK (MCP가 함수를 먼저 만들어 둠). `math.sin/cos`는 **도(degree)** 단위.
- 변환 실패 시 오류 메시지에 **사용자 코드 기준 줄 번호**와 해당 줄이 나온다.
- 모르는 명령은 `entry_block_reference {query:"키워드"}`로 찾으면 python 문법이 함께 나온다.

## 4. 블록 JSON(compact)으로 작성
`entry_set_script {object, blocks:[[스레드1 블록들], [스레드2 블록들]]}`. 각 스레드의 첫 블록은 보통 이벤트 블록.

블록 하나: `{"type":"블록타입", "params":[입력값...], "statements":[[내부블록...], [else블록...]]}`
- `params`는 **입력칸만 순서대로** (아이콘 칸 제외). 생략하면 기본값. `{"KEY":값}` 객체 형태도 가능(키는 entry_block_reference의 args.key).
- 숫자/문자 입력칸엔 리터럴(`10`, `"안녕"`), 참/거짓 칸엔 `true/false`, 또는 다른 값 블록 객체를 넣는다.
- 드롭다운은 값(`"PLUS"`, `"speak"`) 또는 한글 표시명. **변수/리스트/신호/오브젝트/모양/소리/장면은 이름**으로 쓰면 id로 자동 변환. 키는 `"space"`, `"a"`, `"left"` 등.
- 없는 신호 이름은 자동 생성. 없는 변수·모양은 warnings에 표시.
- 함수 호출: `{"type":"call","function":"함수이름","params":[...]}`.
- `statements` 대신 `"do":[...]`, `"then":[...]`, `"else":[...]`도 가능.

```json
[[
  {"type":"when_run_button_click"},
  {"type":"locate_xy","params":[0,-90]},
  {"type":"repeat_inf","statements":[[
    {"type":"_if","params":[{"type":"is_press_some_key","params":["left"]}],"statements":[[{"type":"move_x","params":[-6]}]]},
    {"type":"if_else","params":[{"type":"reach_something","params":["mouse"]}],
     "then":[{"type":"dialog","params":["닿았다!","speak"]}],
     "else":[{"type":"remove_dialog"}]}
  ]]}
],[
  {"type":"when_message_cast","params":["발사"]},
  {"type":"text_write","params":[{"type":"combine_something","params":["점수: ",{"type":"get_variable","params":["점수"]}]}]}
]]
```

자주 쓰는 블록 타입: `when_run_button_click`, `when_some_key_pressed`, `when_object_click`, `when_message_cast`, `message_cast`, `when_scene_start`, `start_scene`, `wait_second`, `repeat_basic`, `repeat_inf`, `repeat_while_true`, `_if`, `if_else`, `wait_until_true`, `stop_object`, `when_clone_start`, `create_clone`, `delete_clone`, `move_direction`, `move_x`, `move_y`, `locate_xy`, `locate_xy_time`, `locate`, `rotate_relative`, `direction_absolute`, `see_angle_object`, `bounce_wall`, `show`, `hide`, `dialog`, `dialog_time`, `change_to_some_shape`, `change_to_next_shape`, `change_effect_amount`, `set_scale_size`, `change_object_index`, `text_write`, `sound_something_with_block`, `reach_something`, `is_press_some_key`, `boolean_basic_operator`(EQUAL/NOT_EQUAL/GREATER/LESS/GREATER_OR_EQUAL/LESS_OR_EQUAL), `boolean_and_or`(AND/OR), `boolean_not`, `calc_basic`(PLUS/MINUS/MULTI/DIVIDE), `calc_rand`, `calc_operation`, `quotient_and_mod`, `coordinate_object`, `coordinate_mouse`, `combine_something`, `get_variable`, `set_variable`, `change_variable`, `ask_and_wait`, `get_canvas_input_value`, `add_value_to_list`, `value_of_index_from_list`, `length_of_list`.
정확한 인자는 항상 `entry_block_reference {types:[...]}`로 확인.

### 함수 (블록)
`entry_define_function`:
```json
{"name":"점프하기","params":["높이",{"label":"만큼"}],
 "body":[{"type":"move_y","params":[{"type":"param","name":"높이"}]}]}
```
- 값 반환: `"kind":"value","return_value":{...}` / 지역변수: `"local_variables":["i"]` + `{"type":"local_set","name":"i","value":0}`, `{"type":"local_get","name":"i"}`.
- 함수 이름 뒤에 `{label}`을 넣은 함수나 값 반환/지역변수 함수가 있으면 파이썬 모드 전환이 거부된다(엔트리 제약).

## 5. 실행 검증 요령
- `entry_run {action:"start", wait_ms}` → 스크린샷 + 변수/오브젝트 상태 + 에러 로그. 항상 실제로 돌려보고 확인할 것.
- `entry_input`: `{"type":"key","key":"right","duration_ms":500}`(누르고 있기), `{"type":"click","x":0,"y":0}`(무대 좌표), `{"type":"text","text":"답"}`(묻고 기다리기 대답), `{"type":"wait","ms":300}`.
- 상태의 `clones`(복제본 수), `saying`(말풍선), `picture`, `visible`로 로직 검증.
- 코드 수정/오브젝트 변경 도구는 실행 중이면 자동으로 정지 후 적용한다.

## 6. 고품질 작품 체크리스트
- 배경 + 어울리는 캐릭터/소품을 라이브러리에서 고르고 `entry_preview_assets`로 확인. 크기와 위치를 무대 안에 맞게 조정.
- 시작 화면(제목·조작법 글상자) → 게임 장면 → 결과(게임오버/클리어) 장면을 장면 + 신호로 구성.
- 점수·시간·생명은 변수(무대 표시 위치 정리) 또는 글상자로 깔끔하게 표시.
- 캐릭터 애니메이션: 모양이 여러 개인 스프라이트에서 반복 + `change_shape_to("next")` + 짧은 대기.
- 효과음/배경음악(`entry_object_assets add_sound`)으로 피드백.
- 복제본으로 적·총알·아이템 다수 생성, 화면 밖으로 나가면 `remove_this_clone()`.
- 좌우로 움직이는 캐릭터는 `rotateMethod:"vertical"`.
- 완성 후 `entry_run` + `entry_input`으로 실제 플레이 테스트, 저장.

## 6-1. 성능 (계산이 많은 작품: 레이캐스팅, 많은 칸 그리기 등)
- 엔트리 반복문(`while`/`for`/반복 블록)은 **한 바퀴에 한 프레임(1/60초)**. 1000번 도는 계산 = 16초 이상.
- **반복문이 없는 함수 호출은 한 프레임 안에 즉시 끝난다** → 무거운 반복 계산은 재귀 함수로 작성 (깊이 수백까지 OK).
  예: `def 열그리기(i): ...; if i < 47: 열그리기(i + 1)` / 범위 분할 `def 그리기(a, b): if b - a > 1: 그리기(a, m); 그리기(m, b)`.
- 블록 하나 실행 비용 대략: 함수 호출 ~80µs, 변수 대입/`+=` ~25~30µs, 계산 ~6µs. 프레임당 수천 블록이면 FPS가 떨어지므로 대입 줄이기·반복 펼치기(한 호출에서 여러 단계)·고정값은 리스트로 미리 계산.
- 붓으로 매 프레임 다시 그리기: `clear_drawing()` 후 같은 프레임 안에서(재귀 함수로) 모두 그리면 깜빡임 없음. 숨긴 오브젝트도 붓은 그려진다.
- 붓 색은 문자열 식 가능: `Entry.set_brush_color_to(색목록[i])` ("#RRGGBB").
- 이미지 크기: 엔트리는 새 이미지를 (너비+높이)≈200px로 자동 조정한다. 원본 픽셀 크기로 쓰려면 `props:{scale:1}` (480x270 배경 → 무대 꽉 참).
- 예제: `문서\EntryMCP\projects\레이캐스팅 3D 미로.ent` (DDA 레이캐스팅, 48열, 약 16~20 FPS).

## 7. 기타 도구
- `entry_get_project {scripts:"python"|"blocks"}`: 전체 구조 + 코드 / `entry_get_script`: 오브젝트 코드 읽기
- `entry_set_coding_mode`: 엔트리 화면을 블록/파이썬 편집 화면으로 전환(표시만 바뀜)
- `entry_scene`, `entry_object_op`(삭제/복제/선택), `entry_object_assets`(모양/소리 추가·삭제·이름변경)
- `entry_project export_json/import_json`: 원본 project JSON 직접 편집(고급)
- `entry_logs`, `entry_eval_js`: 디버깅용 (전역 `Entry`, `window.__entryMcp` 헬퍼)
