# Entry MCP 가이드 (AI 에이전트용: Claude, Codex 등)

사용자 PC에 설치된 **엔트리 오프라인 앱**을 직접 조작해 작품을 만든다. 블록 변환·파이썬 변환·실행·저장은 모두 엔트리 앱 자체 기능을 그대로 쓰므로, 결과물은 사람이 엔트리에서 만든 작품과 같다. 모든 작업은 사용자가 보고 있는 **실제 엔트리 창에서 실시간으로** 일어난다.

## 0. 먼저 지킬 것 (사용자 작업 보호)
- `entry_project new/open`, `entry_launch {restart:true}`는 **현재 열린 작품을 버린다.** 사용자가 만들던 작품일 수 있으면 먼저 물어보거나 `entry_project save`로 저장한 뒤 진행.
- 작은 수정은 작품을 새로 만들지 말고 **열린 작품을 그대로 고친다** (`entry_set_script`로 해당 오브젝트 코드만 교체, `entry_update_object`로 속성만 변경). 구조가 크게 바뀔 때만 새로 만든다.
- 작업 중 사용자가 엔트리 창을 직접 조작하면 서로 꼬일 수 있다. 같은 엔트리 창을 두 에이전트가 동시에 조작하지 않는다.
- `entry_eval_js`는 다른 도구로 안 될 때만 쓴다(엔트리 내부를 직접 바꿀 수 있음).

## 1. 작업 폴더 (MCP 첫 실행 시 자동 생성)
`문서\EntryMCP\` (환경변수 `ENTRY_MCP_HOME`으로 변경 가능)
- `projects\` 저장한 .ent / `images\` 사용할 이미지 / `sounds\` 사용할 소리 / `screenshots\` 캡처 / `json\` 내보낸 JSON
- 도구에 **상대경로**를 주면 이 폴더 기준. `entry_project save`는 path 생략 시 `projects\<작품이름>.ent`.
- 실제 경로는 `entry_status`의 `workspace`에서 확인.
- 직접 그린 이미지(SVG/PNG)를 `images\`에 저장하고 `entry_add_object {source:"image", image_paths:[...]}`로 오브젝트로 쓸 수 있다. 여러 파일 = 모양 여러 개.

## 2. 기본 작업 흐름
1. `entry_launch` → 연결. 엔트리를 사용자가 직접 켜 둔 상태면 디버깅 포트가 없어 연결이 안 되므로 재시작이 필요하다(§0 확인). 작품 복구 대화상자가 뜨면 사용자에게 물어보고 `recovery` 지정.
2. `entry_project {action:"new", name, empty:true}` → 빈 작품 (empty 생략 시 기본 엔트리봇 포함)
3. 에셋: `entry_search_assets` → (`entry_preview_assets`로 눈으로 확인) → `entry_add_object`
   - 배경은 `kind:"background"`로 검색해서 추가 (자동으로 맨 뒤 + 잠금)
   - 글상자(`source:"textbox"`)로 제목/점수/안내문 UI 구성
4. 데이터: `entry_data`로 변수(초기값, 무대 표시 여부/위치), 리스트(items), 신호. 이미 있는 리스트 내용 전체 교체는 `{kind:"list", action:"set", name, items:[...]}` (수천 칸도 가능).
5. 코드: `entry_set_script` (python 또는 blocks). **결과의 warnings / created를 반드시 확인.**
6. 검증: `entry_run` (스크린샷+상태) → `entry_input`(키/클릭/대답 입력) → `entry_runtime_state` → 문제 수정 반복
7. `entry_project {action:"save"}` → 저장. 최종 화면은 `entry_screenshot {save_as}`로 남길 수 있음.

## 3. 무대 / 좌표 / 속성
- 무대 480×270. x: -240(왼쪽)~240(오른쪽), y: -135(아래)~135(위). 중심 (0,0).
- `rotation`(방향) 기본 0 = 그림 원래 각도. `direction`(이동 방향) 기본 90 = 오른쪽, 0 = 위.
- `rotateMethod`: free(360°회전) / vertical(좌우 뒤집기만 – 좌우로 걷는 캐릭터에 적합) / none.
- `size` = 엔트리 '크기' 값 = (보이는 너비 + 보이는 높이) / 2 픽셀. **새로 추가한 이미지는 엔트리가 (너비+높이)≈200px이 되게 자동 조정**한다. 원본 픽셀 크기 그대로 쓰려면 `props:{scale:1}` (480×270 그림 → 무대 꽉 참).
- 라이브러리 스프라이트는 보통 `size` 30~80 정도로 줄여야 보기 좋다.
- `layer`: 0이 맨 앞. 배경은 맨 뒤.
- 글상자 props: `text`, `fontSize`, `color`, `bgColor`, `lineBreak`, `width`/`height`, `textAlign`. 글이 길면 무대 밖으로 잘리므로 짧게 쓰거나 여러 글상자로 나눈다.
- 실행 후 정지하면 오브젝트는 실행 전 상태로 되돌아간다. 초기 위치/모양은 `entry_update_object`로 정하거나 시작 스크립트에서 설정.

## 4. 엔트리파이썬으로 코드 작성 (권장: 짧고 정확)
`entry_set_script {object, python}` – 엔트리 자체 변환기가 블록으로 바꾼다. `import Entry`는 생략 가능.
`mode:"replace"`(기본)는 그 오브젝트의 코드 전체를 교체, `"append"`는 덧붙임.

```python
점수 = 0            # 전역 변수 (대입하면 자동 생성)

def 점프(높이):       # 사용자 함수 (일반 함수만, 반환값 없음)
    Entry.add_y(높이)

def when_start():                    # 시작하기 버튼
    Entry.set_xy(0, -90)
    while True:                      # 계속 반복 (한 바퀴 = 한 프레임)
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
- 계산: `random.randint(a, b)`(정수. 소수가 필요하면 `random.randint(-100, 100) / 100`), `+ - * / %`, `//`, `Entry.value_of_mouse_pointer("x"|"y")`, `Entry.value_of_object("self"|"오브젝트", "x"|"y"|"size"|"rotation"|"direction"|"shape_number"|"shape_name")`, `Entry.value_of_distance_to("오브젝트"|"mouse_pointer")`, `Entry.value_of_timer()`, `Entry.timer("start"|"stop"|"reset")`, `Entry.timer_view("show"|"hide")`, `Entry.value_of_current_time("year"|"month"|"day"|"hour"|"minute"|"second")`
- 수학: `math.sin/cos/tan/asin/acos/atan(x)`(**도(degree) 단위**), `math.sqrt`, `math.fabs`(절댓값), `math.floor`, `math.ceil`, `math.round`, `math.log10`, `math.log`, `x ** 2`(제곱). **exp·임의 거듭제곱은 없다** → 예: 시그모이드 대신 softsign `x / (1 + math.fabs(x))`.
- 문자: `len(문자열)`, `"점수: " + 점수`(숫자와 합치기 가능), `s[i]`, `s[a:b]`, `s.find(x)`, `s.replace(a, b)`, `s.upper()`
- 자료: `변수 = 값`, `변수 += 값`, `Entry.input("질문")` + `Entry.answer()`, `Entry.answer_view("show"|"hide")`, `Entry.show_variable("변수명")`, `Entry.hide_variable("변수명")`, 리스트 `목록.append(x)`, `목록.pop(i)`, `목록.insert(i, x)`, `목록[i] = x`, `목록[i]`, `len(목록)`, `x in 목록`, `Entry.show_list("목록명")`
- 장면/신호: `Entry.send_signal("신호")`, `Entry.send_signal_wait("신호")`, `Entry.start_scene("장면")`, `Entry.start_scene_of("next"|"prev")`

### 엔트리파이썬 주의점
- **리스트/문자 인덱스는 0부터** (`목록[0]`이 첫 항목 → 블록의 1번째 항목으로 변환됨).
- 파이썬 이름 ≠ 블록 값인 것들: 마우스 = `"mouse_pointer"`, 벽 = `"edge"`, `stop_code("self")` = 자신의 코드, 모양 번호/이름 = `"shape_number"`/`"shape_name"`. 블록 값으로 잘못 쓰면 MCP가 자동 보정하고 warnings에 알려준다.
- 한 이벤트 함수는 하나의 블록 묶음(스레드). 같은 이벤트를 여러 개 정의해도 된다. 같은 오브젝트의 이벤트들은 전역 변수를 함께 쓴다.
- 지원 안 되는 것: `continue`(블록 `continue_repeat`은 blocks로만), 값 반환 함수(`return`), 함수 지역변수, 채우기 블록(§6) → 이런 건 `entry_define_function`(블록)이나 blocks로 만든다. 파이썬에서 `def 함수(인자):`는 일반 함수만.
- **리스트 리터럴(`[1, 2]`, `[]`) 불가** → `entry_data {kind:"list", action:"add", items:[...]}`로 먼저 만들고 코드에선 `목록[i]`, `목록.append(x)`, `목록[i] = x`. (MCP가 감지해서 오류로 알려줌)
- 코드에서 대입(`이름 = 값`)하는 변수는 MCP가 미리 **숨김 전역 변수**로 만들어 둔다(함수 안에서 먼저 읽어도 OK). 무대에 보이게 하려면 `entry_data {action:"set", visible:true}`.
- 다른 오브젝트가 대입하는 변수를 읽기만 하는 스크립트는, 그 변수가 이미 있어야 한다 → 대입하는 오브젝트의 스크립트를 먼저 설정하거나 `entry_data`로 먼저 만든다. (없으면 엔트리가 변수를 문자열로 바꿔버리므로 MCP가 오류로 막음)
- 재귀 함수(자기 자신 호출)·뒤에 정의된 함수 호출 OK (MCP가 함수를 먼저 만들어 둠). 블록으로 만든 함수(`entry_define_function`)도 파이썬에서 이름으로 호출할 수 있다(먼저 정의해 둘 것).
- **오브젝트 전용 변수(복제본마다 따로 갖는 값)는 `self.이름`** 으로 쓴다. 먼저 `entry_data {kind:"variable", action:"add", name, scope:"오브젝트이름"}`로 만들고, 코드에서는 반드시 `self.이름`. 그냥 `이름`으로 쓰면 모든 복제본이 공유하는 전역 변수가 새로 생긴다.
  예: 원본이 `self.번호 = k` 후 `Entry.make_clone_of("self")` → 복제본은 그 값을 복사해 가짐 → `def when_make_clone():` 안에서 `self.번호`로 자기 번호 사용. 자기 위치는 `Entry.value_of_object("self", "x")`.
- 변환이 실패하면 아무것도 바뀌지 않고(새로 만든 변수/함수도 되돌림), 오류 메시지에 **사용자 코드 기준 줄 번호**와 해당 줄이 나온다.
- 모르는 명령은 `entry_block_reference {query:"키워드"}`로 찾으면 python 문법이 함께 나온다. python 문법이 비어 있는 블록은 파이썬으로 쓸 수 없다.

## 5. 블록 JSON(compact)으로 작성
`entry_set_script {object, blocks:[[스레드1 블록들], [스레드2 블록들]]}`. 각 스레드의 첫 블록은 보통 이벤트 블록.

블록 하나: `{"type":"블록타입", "params":[입력값...], "statements":[[내부블록...], [else블록...]]}`
- `params`는 **입력칸만 순서대로** (아이콘 칸 제외). 생략하면 기본값. `{"KEY":값}` 객체 형태도 가능(키는 entry_block_reference의 args.key).
- 숫자/문자 입력칸엔 리터럴(`10`, `"안녕"`), 참/거짓 칸엔 `true/false`, 또는 다른 값 블록 객체를 넣는다.
- 드롭다운은 값(`"PLUS"`, `"speak"`) 또는 한글 표시명. **변수/리스트/신호/오브젝트/모양/소리/장면은 이름**으로 쓰면 id로 자동 변환. 키는 `"space"`, `"a"`, `"left"` 등.
- **블록의 리스트 번호는 1부터** (파이썬과 다름).
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

자주 쓰는 블록 타입: `when_run_button_click`, `when_some_key_pressed`, `when_object_click`, `when_message_cast`, `message_cast`, `when_scene_start`, `start_scene`, `wait_second`, `repeat_basic`, `repeat_inf`, `repeat_while_true`, `_if`, `if_else`, `wait_until_true`, `stop_object`, `when_clone_start`, `create_clone`, `delete_clone`, `move_direction`, `move_x`, `move_y`, `locate_xy`, `locate_xy_time`, `locate`, `rotate_relative`, `direction_absolute`, `see_angle_object`, `bounce_wall`, `show`, `hide`, `dialog`, `dialog_time`, `change_to_some_shape`, `change_to_next_shape`, `change_effect_amount`, `set_scale_size`, `change_object_index`, `text_write`, `sound_something_with_block`, `reach_something`, `is_press_some_key`, `boolean_basic_operator`(EQUAL/NOT_EQUAL/GREATER/LESS/GREATER_OR_EQUAL/LESS_OR_EQUAL), `boolean_and_or`(AND/OR), `boolean_not`, `calc_basic`(PLUS/MINUS/MULTI/DIVIDE), `calc_rand`, `calc_operation`, `quotient_and_mod`, `coordinate_object`, `coordinate_mouse`, `combine_something`, `get_variable`, `set_variable`, `change_variable`, `ask_and_wait`, `get_canvas_input_value`, `add_value_to_list`, `value_of_index_from_list`, `length_of_list`, `set_fill_color`, `start_fill`, `stop_fill`.
정확한 인자는 항상 `entry_block_reference {types:[...]}`로 확인.

### 함수 (블록)
`entry_define_function`:
```json
{"name":"점프하기","params":["높이",{"label":"만큼"}],
 "body":[{"type":"move_y","params":[{"type":"param","name":"높이"}]}]}
```
- 값 반환: `"kind":"value","return_value":{...}` / 지역변수: `"local_variables":["i"]` + `{"type":"local_set","name":"i","value":0}`, `{"type":"local_get","name":"i"}`.
- 함수 이름 뒤에 `{label}`을 넣은 함수나 값 반환/지역변수 함수가 있으면 파이썬 모드 전환이 거부된다(엔트리 제약). 작품 자체는 블록 모드에서 정상 동작한다.
- 함수 안의 동작(이동·붓 등)은 **그 함수를 호출한 오브젝트**에 적용된다.

## 6. 그리기 (붓 / 채우기)
- 붓: `set_xy`로 이동 → `start_drawing()` → 이동하면 선이 그려짐 → `stop_drawing()`. 선 끝은 각진 모양이라 굵은 짧은 선 = 사각형.
- 붓 색은 문자열 식 가능: `Entry.set_brush_color_to(색목록[i])` ("#RRGGBB"). 미리 만든 색 리스트에서 골라 쓰면 명암/그라데이션 표현이 쉽다.
- **또렷한 픽셀/덧칠 잔상 방지**: 기본 엔트리 화면에서 무대 1 = 화면 4/3 픽셀이다. 칸 크기·위치를 **0.75의 배수**(예: 4.5, 7.5)로 맞추면 경계가 화면 픽셀에 딱 맞아 번짐이 없고, 같은 칸을 배경색으로 덧칠해 지울 때 테두리 잔상이 남지 않는다. (덧칠이 수천 번 쌓이면 가끔 `clear_drawing()` 후 다시 그려 정리)
- 배경·기계 테두리 같은 그래픽은 직접 그린 큰 PNG(예: 960×540)를 `props:{scale:0.5}`로 넣으면 선명하다. 화면 위 반사·주사선 같은 효과는 투명 PNG를 그림 오브젝트보다 앞 레이어에 둔다.

### 소리
- 직접 만든 소리 파일(mp3 권장)을 `sounds\`에 두고 `entry_object_assets {object, action:"add_sound", files:["삐.mp3"]}`로 추가 → 소리 이름은 파일 이름(확장자 제외).
- 재생: `Entry.play_sound("이름")`, 길이 지정 `Entry.play_sound_for_sec("이름", 초)`(기다리지 않음), `Entry.play_sound_and_wait("이름")`.
- 효과음은 짧은 파형을 코드로 만들어 mp3로 바꾸면 된다(예: 사각파 = 옛 게임기 삐 소리).
- `clear_drawing()`은 **그 오브젝트가 그린 것만** 지운다. 갱신 주기가 다른 그림(예: 배경 격자 / 매 프레임 바뀌는 그림)은 오브젝트를 나눠서 그린다. 숨긴 오브젝트도 붓은 그려진다.
- 매 프레임 다시 그릴 때는 `clear_drawing()` 후 **같은 프레임 안에서**(반복문 대신 재귀 함수로, §7) 모두 그리면 깜빡임이 없다.
- **다각형 채우기**: `set_fill_color` / `start_fill` / `stop_fill` 블록은 파이썬 문법이 없다. 꼭짓점 좌표를 리스트/변수에 넣어 두고, 채우기 함수를 `entry_define_function`(블록)으로 만든 뒤 파이썬에서 호출한다:
  ```json
  {"name":"면칠하기","params":[],"body":[
    {"type":"set_fill_color","params":[{"type":"get_variable","params":["칠색"]}]},
    {"type":"locate_xy","params":[{"type":"get_variable","params":["x1"]},{"type":"get_variable","params":["y1"]}]},
    {"type":"start_fill"},
    {"type":"locate_xy","params":[{"type":"get_variable","params":["x2"]},{"type":"get_variable","params":["y2"]}]},
    {"type":"locate_xy","params":[{"type":"get_variable","params":["x3"]},{"type":"get_variable","params":["y3"]}]},
    {"type":"locate_xy","params":[{"type":"get_variable","params":["x1"]},{"type":"get_variable","params":["y1"]}]},
    {"type":"stop_fill"}]}
  ```
  (사용할 변수는 `entry_data`로 먼저 만들 것.) 3D 면 그리기는 먼 것부터 그리면(페인터 알고리즘) 가려짐이 표현된다.

## 7. 성능 (계산이 많은 작품: 3D, 시뮬레이션, 신경망 등)
엔트리 블록은 느리다. 아래는 실제 측정값 기준 요령.
- 반복문(`while`/`for`/반복 블록)은 **한 바퀴에 한 프레임(1/60초)**. 1000번 도는 계산 = 16초 이상.
- **반복문이 없는 함수 호출은 한 프레임 안에 끝난다** → 무거운 반복 계산은 재귀 함수로 작성 (깊이 수백까지 OK).
  예: `def 열그리기(i): ...; if i < 47: 열그리기(i + 1)` / 범위 분할 `def 그리기(a, b): if b - a > 1: 그리기(a, m); 그리기(m, b)`.
- 대략적인 비용: 함수 호출 ~80µs, **변수에 쓰기 ~15~30µs**(변수 개수가 많을수록 느려짐), **리스트 칸에 쓰기 ~3µs**, 사칙연산(`+ - * /`, 엔트리가 정밀 계산 라이브러리로 처리) ~9µs, `math.*`·`** 2` ~1.5µs, 읽기 ~2µs.
- 그래서:
  1. **자주 바뀌는 값은 변수 대신 리스트 하나에 모아 저장** (`N[0]`, `N[1]`, ...). 신경망 가중치 등에 효과가 크다.
  2. 반복을 펼쳐 쓰고(코드 생성), 고정값(각도표·색표 등)은 리스트로 미리 계산해 둔다.
  3. 같은 식을 두 번 쓰는 대신 중간값을 리스트에 저장, 제곱은 `x * x` 대신 `x ** 2`.
  4. 화면 그리기는 필요할 때만(값이 바뀔 때, 또는 0.1~0.5초 간격) 다시 그린다.
  5. 계산이 몰리는 작업은 프레임당 양을 조절(예: 프레임당 3회)해서 화면이 끊기지 않게 한다.
- 성능 확인: 작품 안에 FPS나 처리량(예: 초당 반복 수)을 변수로 세어 표시하고 `entry_runtime_state`로 읽는다.
- 참고 수치: DDA 레이캐스팅 48열 ≈ 16~20 FPS, 2-4-4-1 신경망 역전파 학습 ≈ 초당 60에포크(XOR).

## 8. 실행 검증 요령
- `entry_run {action:"start", wait_ms}` → 스크린샷 + 변수/오브젝트 상태 + 에러 로그. 항상 실제로 돌려보고 확인할 것.
- `entry_input`: `{"type":"key","key":"right","duration_ms":500}`(누르고 있기), `{"type":"click","x":0,"y":0}`(무대 좌표), `{"type":"text","text":"답"}`(묻고 기다리기 대답), `{"type":"wait","ms":300}`.
- 상태의 `clones`(복제본 수), `saying`(말풍선), `picture`, `visible`, 변수·리스트 값으로 로직 검증.
- 무대 스크린샷은 캡처 직전에 무대를 강제로 다시 그려서 찍으므로, 엔트리 창이 가려져 있거나 최소화돼 있어도 현재 상태가 찍힌다. 그래도 로직은 `entry_runtime_state` 값으로 함께 확인하는 것이 정확하다.
- 코드 수정/오브젝트 변경 도구는 실행 중이면 자동으로 정지 후 적용한다.

## 9. 고품질 작품 체크리스트
- 배경 + 어울리는 캐릭터/소품을 라이브러리에서 고르고 `entry_preview_assets`로 확인. 크기와 위치를 무대 안에 맞게 조정.
- 시작 화면(제목·조작법 글상자) → 게임 장면 → 결과(게임오버/클리어) 장면을 장면 + 신호로 구성.
- 점수·시간·생명은 변수(무대 표시 위치 정리) 또는 글상자로 깔끔하게 표시. 계산용 변수는 숨긴다.
- 캐릭터 애니메이션: 모양이 여러 개인 스프라이트에서 반복 + `change_shape_to("next")` + 짧은 대기.
- 효과음/배경음악(`entry_object_assets add_sound`)으로 피드백.
- 복제본으로 적·총알·아이템 다수 생성, 화면 밖으로 나가면 `remove_this_clone()`.
- 좌우로 움직이는 캐릭터는 `rotateMethod:"vertical"`.
- 조작법은 화면에 글상자로 안내.
- 완성 후 `entry_run` + `entry_input`으로 실제 플레이 테스트, 저장.

## 10. 기타 도구
- `entry_get_project {scripts:"python"|"blocks"}`: 전체 구조 + 코드 / `entry_get_script`: 오브젝트 코드 읽기
- `entry_set_coding_mode`: 엔트리 화면을 블록/파이썬 편집 화면으로 전환(표시만 바뀜)
- `entry_scene`, `entry_object_op`(삭제/복제/선택), `entry_object_assets`(모양/소리 추가·삭제·이름변경)
- `entry_project export_json/import_json`: 원본 project JSON 직접 편집(고급)
- `entry_logs`, `entry_eval_js`: 디버깅용 (전역 `Entry`, `window.__entryMcp` 헬퍼)
