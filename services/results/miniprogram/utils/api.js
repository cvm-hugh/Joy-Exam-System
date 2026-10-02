const config = require('../config');
function request(path, data) {
  const account =
    typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync()
      : null;
  if (
    account &&
    account.miniProgram.envVersion === 'release' &&
    (config.environment !== 'production' ||
      !config.apiBase.startsWith('https://'))
  ) {
    return Promise.reject(new Error('正式版服务尚未配置，请联系工作人员。'));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.apiBase + path,
      method: data === undefined ? 'GET' : 'POST',
      data,
      timeout: 10000,
      header: { 'content-type': 'application/json' },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300)
          resolve(response.data);
        else
          reject(
            new Error(
              (response.data && response.data.error) ||
                '查询暂不可用，请稍后重试。',
            ),
          );
      },
      fail() {
        reject(new Error('网络连接失败，请检查网络后重试。'));
      },
    });
  });
}
function imageUrl(path) {
  return path ? config.apiBase.replace(/\/api\/?$/, '') + path : '';
}
module.exports = { request, imageUrl };
