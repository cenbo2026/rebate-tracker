const RPCClient = require('@alicloud/pop-core').RPCClient;

const TEMPLATE_ENV = {
  contract: 'ALIYUN_SMS_TEMPLATE_CONTRACT',
  rebate_due: 'ALIYUN_SMS_TEMPLATE_REBATE_DUE',
  rebate_overdue: 'ALIYUN_SMS_TEMPLATE_REBATE_OVERDUE',
};

function smsConfigured() {
  return Boolean(
    process.env.ALIYUN_ACCESS_KEY_ID &&
    process.env.ALIYUN_ACCESS_KEY_SECRET &&
    process.env.ALIYUN_SMS_SIGN_NAME
  );
}

function createClient() {
  return new RPCClient({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    endpoint: `https://${process.env.ALIYUN_SMS_ENDPOINT || 'dysmsapi.aliyuncs.com'}`,
    apiVersion: '2017-05-25',
  });
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2);
  return digits;
}

async function sendInfluencerSms(type, { phone, templateParam }) {
  if (!smsConfigured()) {
    throw new Error('未配置阿里云短信，请在 Render 环境变量中设置 ALIYUN_ACCESS_KEY_ID 等');
  }

  const envKey = TEMPLATE_ENV[type];
  const templateCode = envKey ? process.env[envKey] : '';
  if (!templateCode) {
    throw new Error(`未配置短信模板：${envKey}`);
  }

  const phoneNumbers = normalizePhone(phone);
  if (!/^1\d{10}$/.test(phoneNumbers)) {
    throw new Error('达人手机号格式不正确，需为 11 位国内号码');
  }

  const client = createClient();
  const result = await client.request('SendSms', {
    PhoneNumbers: phoneNumbers,
    SignName: process.env.ALIYUN_SMS_SIGN_NAME,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(templateParam),
  }, { method: 'POST' });

  if (result.Code !== 'OK') {
    throw new Error(result.Message || result.Code || '短信发送失败');
  }
  return { bizId: result.BizId, requestId: result.RequestId };
}

module.exports = { sendInfluencerSms, smsConfigured, normalizePhone };
