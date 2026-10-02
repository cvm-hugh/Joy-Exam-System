App({
  globalData: { result: null, resultRevision: null },
  onHide() {
    this.globalData.result = null;
    this.globalData.resultRevision = null;
  },
});
