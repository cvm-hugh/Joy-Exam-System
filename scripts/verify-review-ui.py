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
         'choice_other.png_q1': 'C', 'reviewer': '测试复核人'}
namespace = {'st': SimpleNamespace(session_state=state)}
exec(compile(ast.Module(body=[reset], type_ignores=[]), '<review-reset-helper>', 'exec'), namespace)
namespace['reset_review_widgets']('first.png')
assert state == {'choice_other.png_q1': 'C', 'reviewer': '测试复核人'}
namespace['reset_review_widgets']()
assert state == {'reviewer': '测试复核人'}
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
from PIL import Image
from openpyxl import Workbook
from app.constants import CONFIG_DIR, ensure_runtime_config
ensure_runtime_config()
workbook = Workbook()
workbook.active.append(['Exam ID', 'Chinese Name', 'Year Level', 'Branch', 'Class', 'Exam Session'])
workbook.active.append(['001001', '测试学生', '六年级', '测试分校', '测试班级', '测试场次'])
workbook.save(CONFIG_DIR / 'student_list.xlsx')
(CONFIG_DIR / 'answer_key.json').write_text(json.dumps({'listening_part1': {str(n): 'A' for n in range(1, 9)}}))
Image.new('RGB', (900, 600), 'white').save(PHOTOS / 'synthetic-card.png')
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
    record = {'Source Image': image, 'Source Path': str(PHOTOS / image), 'File Name': image,
              'Exam ID': '001001', 'Chinese Name': '测试学生', 'Year Level': '六年级',
              'Branch': '测试分校', 'Class': '测试班级', 'Exam Session': '测试场次',
              'Scan Result Status': '测试识别结果', 'Status': 'CHECK_MARK', 'Identity Issue': '',
              **{column: 0 for column in PART_SCORE_COLUMNS}}
    items = [{'Source Image': image, 'Exam ID': '001001', 'Section': 'listening_part1',
              'Question': str(n), 'Marked Answer': '', 'Is Correct': 'N', 'Answer Status': 'BLANK'} for n in range(1, 9)]
    issues = [{'key': f'listening_part1:{n}', 'section': 'listening_part1', 'number': str(n),
               'title': f'Listening Part 1 第 {n} 题', 'detail': '当前识别结果：空白',
               'crop': None, 'choices': ['A', 'B', 'C']} for n in range(1, 9)]
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
            for zoom in sys.argv[1:] or ['75', '100', '110']:
                print(f'Verifying review UI at {zoom}% zoom...', flush=True)
                browser_env = {**os.environ, 'JOY_TEST_ZOOM': zoom}
                subprocess.run([os.environ.get('JOY_NODE_BIN', 'node'), str(ROOT / 'scripts/verify-review-ui.mjs'), str(port)], env=browser_env, check=True)
            sessions = list((data / 'sessions').glob('*.json'))
            assert len(sessions) == 1
            saved = json.loads(sessions[0].read_text())
            assert len(saved['audit_log']) == 10
            assert saved['audit_log'][0]['Corrected Value'] == 'A'
            assert saved['audit_log'][1]['Original Value'] == 'A'
            assert saved['audit_log'][1]['Corrected Value'] == 'B'
            assert all(entry['Operator'] == '测试复核人' for entry in saved['audit_log'])
            assert all(row['Marked Answer'] == 'A' for row in saved['item_rows'])
            assert len(saved['resolved']) == 8 and saved['records'][0]['Status'] == 'OK'
            print('Persisted synthetic audit entries:', len(saved['audit_log']))
        except Exception:
            print(log.read_text()[-3000:])
            raise
        finally:
            process.terminate()
            process.wait(timeout=15)
