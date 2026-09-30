import type { ToolbarStatus } from '../lib/toolbarPdfAction';

const messages: Record<ToolbarStatus, string> = {
  'not-pdf': '当前页面不是 PDF 文件或 PDF 直链。',
  unavailable: '无法读取当前标签页地址，或无法作为 PDF 打开。',
  'permission-denied': '未获得访问此 PDF 网站的权限。',
  'open-failed': '无法打开 PDF 阅读器。',
};

const status = location.hash.slice(1) as ToolbarStatus;
const message = document.getElementById('message');
if (message) message.textContent = messages[status] ?? messages.unavailable;
