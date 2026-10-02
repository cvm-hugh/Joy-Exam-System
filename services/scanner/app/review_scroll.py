"""Keep the active review form in view while Streamlit redraws its fragment."""
from pathlib import Path
from html import escape

import streamlit as st


def install_review_scroll_lock(navigation: dict | None = None) -> None:
    # A fixed iframe size avoids the automatic content measurement script.
    # The listener lives in the parent document and also survives fragment reruns.
    st.iframe(Path(__file__).with_suffix('.html'), height=1, width='stretch')
    navigation = navigation or {}
    # The parent listener observes this request while Streamlit replaces the cards.
    # Keep its token across redraws so later question saves cannot repeat the jump.
    target = escape("st-key-" + navigation.get("target", ""), quote=True)
    token = escape(navigation.get("token", ""), quote=True)
    st.markdown(
        f'<span hidden id="joy-review-navigation" data-target="{target}" data-token="{token}"></span>',
        unsafe_allow_html=True,
    )
