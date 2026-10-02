const api = require('../../utils/api');
Page({
  data: {
    name: '',
    examNo: '',
    title: '看见成长的每一面',
    description: '请输入学生中文姓名和考号，查看本次考试的六维评价。',
    greeting: 'HELLO!',
    welcome: 'Welcome to the\nExam Result Query System.',
    footer: '每一份成长，都值得看见。',
    open: false,
    ready: false,
    message: '',
    error: '',
    loading: false,
  },
  onShow() {
    this.active = true;
    getApp().globalData.result = null;
    this.setData({
      loading: false,
      error: '',
      ready: false,
      open: false,
      name: '',
      examNo: '',
    });
    this.loadStatus();
  },
  onHide() {
    this.active = false;
    this.setData({ name: '', examNo: '', loading: false });
  },
  onUnload() {
    this.active = false;
  },
  loadStatus() {
    api
      .request('/public/status')
      .then((s) => {
        if (!this.active) return;
        this.revision = s.revision;
        this.setData({
          title: s.title,
          description: s.description,
          greeting: s.greeting ?? 'HELLO!',
          welcome: s.welcome ?? 'Welcome to the\nExam Result Query System.',
          footer: s.footer ?? '每一份成长，都值得看见。',
          open: s.open,
          ready: true,
          message: s.message,
          error: '',
        });
      })
      .catch((e) => {
        if (this.active)
          this.setData({ error: e.message, ready: true, open: false });
      });
  },
  onName(e) {
    this.setData({ name: e.detail.value, error: '' });
  },
  onExamNo(e) {
    this.setData({ examNo: e.detail.value, error: '' });
  },
  submit() {
    if (this.data.loading || !this.data.open) return;
    const name = this.data.name.trim(),
      examNo = this.data.examNo.trim();
    if (!name || !examNo) {
      this.setData({ error: '请填写学生中文姓名和考号。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    api
      .request('/public/query', { name, examNo })
      .then((result) => {
        if (!this.active) return;
        getApp().globalData.result = result;
        getApp().globalData.resultRevision = this.revision;
        wx.navigateTo({
          url: '/pages/result/index',
          fail: () => {
            getApp().globalData.result = null;
            this.setData({
              loading: false,
              error: '页面打开失败，请重新查询。',
            });
          },
        });
      })
      .catch((e) => {
        if (this.active) this.setData({ error: e.message, loading: false });
      });
  },
});
