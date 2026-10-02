const api = require('../../utils/api');
Page({
  data: { result: null, error: '', current: 0, pageCount: 0 },
  onShow() {
    this.active = true;
    const app = getApp();
    const result = app.globalData.result;
    if (!result) {
      wx.reLaunch({ url: '/pages/query/index' });
      return;
    }
    this.setData({ result: null });
    api
      .request('/public/status')
      .then((s) => {
        if (!this.active) return;
        if (!s.open || s.revision !== app.globalData.resultRevision) {
          app.globalData.result = null;
          wx.reLaunch({ url: '/pages/query/index' });
          return;
        }
        const normalized = Object.assign({}, result, {
            headerImage: api.imageUrl(result.headerImage),
            footerImage: api.imageUrl(result.footerImage),
            pageCopy: result.pageCopy || {
              abilityHeading: 'Your\nAbility\nAnalysis',
              learningHeading: 'Your\nLearning\nSuggestions',
              learningLabel: '六维评价与学习建议',
            },
            coverBackgroundImage: api.imageUrl(result.coverBackgroundImage),
            coverQrImage: api.imageUrl(result.coverQrImage),
            dimensions: result.dimensions.map((d) =>
              Object.assign({}, d, {
                evaluation: Object.assign({}, d.evaluation, {
                  image: api.imageUrl(d.evaluation.image),
                }),
              }),
            ),
          });
        const hasCover = !!(normalized.coverBackgroundImage || normalized.coverQrImage || normalized.coverText || normalized.coverFooter);
        this.setData({ result: normalized, current: 0, pageCount: 1 + (normalized.admission ? 1 : 0) + 1 + normalized.dimensions.length + (hasCover ? 1 : 0) });
      })
      .catch((e) => {
        if (this.active) this.setData({ result: null, error: e.message });
      });
  },
  onHide() {
    this.active = false;
    this.setData({ result: null });
    getApp().globalData.result = null;
  },
  onUnload() {
    this.active = false;
    getApp().globalData.result = null;
  },
  back() {
    getApp().globalData.result = null;
    wx.reLaunch({ url: '/pages/query/index' });
  },
  onSlideChange(event) {
    this.setData({ current: event.detail.current });
  },
});
