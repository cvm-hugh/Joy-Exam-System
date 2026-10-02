"""Browser regression against actual review source, using only synthetic temporary data."""
from pathlib import Path
import os
import socket
import subprocess
import tempfile
import time
import urllib.request
import json
import ast
from types import SimpleNamespace
import sys

ROOT = Path(__file__).resolve().parents[1]

# Check the real reset helper without executing the application's page setup.
tree = ast.parse((ROOT / 'services/scanner/app/scan_ui.py').read_text())
reset = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'reset_review_widgets')
state = {'choice_first.png_q1': 'A', 'saved_choice_first.png_q1': 'B', 'save_mark_first.png_q1': False,
         'id_first.png': 'S10086', 'confirm_id_first.png': False, 'supplement_name_first.png': '甲',
         'identity_notices': {'first.png': ('error', '旧提示'), 'other.png': ('success', '已保存')},
         'choice_other.png_q1': 'C', 'reviewer': '测试复核人'}
namespace = {'st': SimpleNamespace(session_state=state)}
exec(compile(ast.Module(body=[reset], type_ignores=[]), '<review-reset-helper>', 'exec'), namespace)
namespace['reset_review_widgets']('first.png')
assert state == {'choice_other.png_q1': 'C', 'reviewer': '测试复核人',
                 'identity_notices': {'other.png': ('success', '已保存')}}
namespace['reset_review_widgets']()
assert state == {'reviewer': '测试复核人', 'identity_notices': {}}
print('Fresh-recognition widget reset verified.', flush=True)

with tempfile.TemporaryDirectory(prefix='joy-review-browser-') as temp:
    directory = Path(temp)
    data = directory / 'runtime'
    photos = directory / 'photos'
    photos.mkdir()
    env = {**os.environ, 'DINGWEICE_DATA_DIR': str(data), 'PYTHONDONTWRITEBYTECODE': '1'}
    setup = '''
import json
from pathlib import Path
from shutil import copy2
from openpyxl import Workbook
from app.constants import CONFIG_DIR, ensure_runtime_config
from app.roster_import import save_roster_snapshot
ensure_runtime_config()
workbook = Workbook()
workbook.active.append(['Exam ID', 'Chinese Name', 'Year Level', 'Branch', 'Class', 'Exam Session'])
workbook.active.append(['001001', '测试学生', '六年级', '测试分校', '测试班级', '测试场次'])
workbook.active.append(['S10086', '测试S学生', '六年级', '测试分校', '测试班级', '测试场次'])
workbook.save(PHOTOS / 'synthetic-roster.xlsx')
save_roster_snapshot(PHOTOS / 'synthetic-roster.xlsx', CONFIG_DIR)
(CONFIG_DIR / 'answer_key.json').write_text(json.dumps({'listening_part1': {str(n): 'A' for n in range(1, 9)}}))
copy2(CONFIG_DIR / 'template_reference.png', PHOTOS / 'synthetic-card.png')
'''
    subprocess.run([str(ROOT / '.venv/bin/python'), '-B', '-c', 'from pathlib import Path\nPHOTOS=Path(' + repr(str(photos)) + ')\n' + setup], cwd=ROOT / 'services/scanner', env=env, check=True)
    entry = directory / 'entry.py'
    entry.write_text('''
from pathlib import Path
import sys
import streamlit as st
ROOT = Path(ROOT_TEXT)
sys.path.insert(0, str(ROOT / 'services/scanner'))
from app.scanner import PART_SCORE_COLUMNS
PHOTOS = Path(PHOTO_TEXT)
if 'synthetic_ready' not in st.session_state:
    image = 'synthetic-card.png'
    scenario = st.query_params.get('scenario', 'marks')
    identity_review = scenario != 'marks'
    exam_id = '00?086' if identity_review else '001001'
    record = {'Source Image': image, 'Source Path': str(PHOTOS / image), 'File Name': image,
              'Exam ID': exam_id, 'Chinese Name': '' if identity_review else '测试学生', 'Year Level': '六年级',
              'Branch': '测试分校', 'Class': '测试班级', 'Exam Session': '测试场次',
              'Scan Result Status': '测试识别结果', 'Status': 'CHECK_ID' if identity_review else 'CHECK_MARK',
              'Identity Issue': '考号识别异常' if identity_review else '',
              **{column: 0 for column in PART_SCORE_COLUMNS}}
    items = [{'Source Image': image, 'Exam ID': exam_id, 'Section': 'listening_part1',
              'Question': str(n), 'Marked Answer': '', 'Is Correct': 'N', 'Answer Status': 'BLANK'} for n in range(1, 9)]
    issues = [{'key': f'listening_part1:{n}', 'section': 'listening_part1', 'number': str(n),
               'title': f'Listening Part 1 第 {n} 题', 'detail': '当前识别结果：空白',
               'crop': None, 'choices': ['A', 'B', 'C']} for n in range(1, 9)]
    if scenario == 'id-only':
        items, issues = [], []
    st.session_state.update(synthetic_ready=True, view='scan', records=[record], item_rows=items,
        issues={image: issues}, folder=str(PHOTOS), loaded_session_folder=str(PHOTOS), reviewer='测试复核人')
source = ROOT / 'services/scanner/app/scan_ui.py'
st.session_state.synthetic_full_runs = st.session_state.get('synthetic_full_runs', 0) + 1
exec(compile(source.read_text(), str(source), 'exec'), {'__file__': str(source), '__name__': '__main__'})
st.caption(f"Full app runs: {st.session_state.synthetic_full_runs}")
'''.replace('ROOT_TEXT', repr(str(ROOT))).replace('PHOTO_TEXT', repr(str(photos))))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    log = directory / 'server.log'
    with log.open('w') as output:
        process = subprocess.Popen([str(ROOT / '.venv/bin/python'), '-B', '-m', 'streamlit', 'run', str(entry), '--server.address', '127.0.0.1', '--server.port', str(port), '--server.headless', 'true', '--browser.gatherUsageStats', 'false'], cwd=ROOT / 'services/scanner', env=env, stdout=output, stderr=output)
        try:
            for _ in range(80):
                try:
                    urllib.request.urlopen(f'http://127.0.0.1:{port}/_stcore/health', timeout=1)
                    break
                except OSError:
                    time.sleep(0.25)
            runs = [('marks', zoom) for zoom in sys.argv[1:] or ['75', '100', '110']]
            runs.extend((scenario, '100') for scenario in ('known-s', 'known-numeric', 'missing', 'id-only'))
            for scenario, zoom in runs:
                print(f'Verifying {scenario} review UI at {zoom}% zoom...', flush=True)
                browser_env = {**os.environ, 'JOY_TEST_ZOOM': zoom, 'JOY_IDENTITY_SCENARIO': scenario}
                subprocess.run([os.environ.get('JOY_NODE_BIN', 'node'), str(ROOT / 'scripts/verify-review-ui.mjs'), str(port)], env=browser_env, check=True)
                sessions = list((data / 'sessions').glob('*.json'))
                assert len(sessions) == 1
                saved = json.loads(sessions[0].read_text())
                identity = scenario != 'marks'
                marks = scenario != 'id-only'
                assert len(saved['audit_log']) == (1 if identity else 0) + (10 if marks else 0)
                offset = 1 if identity else 0
                expected_id = '019999' if scenario == 'missing' else '010086' if identity else '001001'
                assert saved['records'][0]['Exam ID'] == expected_id
                assert all(row['Exam ID'] == expected_id for row in saved['item_rows'])
                if marks:
                    assert saved['audit_log'][offset]['Corrected Value'] == 'A'
                    assert saved['audit_log'][offset + 1]['Original Value'] == 'A'
                    assert saved['audit_log'][offset + 1]['Corrected Value'] == 'B'
                if identity:
                    original = 'S19999' if scenario == 'missing' else 'S10086'
                    assert saved['records'][0]['Original Exam ID'] == original
                    assert saved['audit_log'][0]['Original Value'] == '00?086'
                assert all(entry['Operator'] == '测试复核人' for entry in saved['audit_log'])
                assert all(row['Marked Answer'] == 'A' for row in saved['item_rows'])
                assert len(saved['resolved']) == (8 if marks else 0) and saved['records'][0]['Status'] == 'OK'
                print('Persisted synthetic audit entries:', len(saved['audit_log']), flush=True)
        except Exception:
            print(log.read_text()[-3000:])
            raise
        finally:
            process.terminate()
            process.wait(timeout=15)
