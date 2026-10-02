"""Keep the active review form in view while Streamlit redraws its fragment."""
from pathlib import Path

import streamlit as st


def install_review_scroll_lock() -> None:
    # A fixed iframe size avoids the automatic content measurement script.
    # The listener lives in the parent document and also survives fragment reruns.
    st.iframe(Path(__file__).with_suffix('.html'), height=1, width='stretch')
