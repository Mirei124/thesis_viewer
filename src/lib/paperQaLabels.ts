const en = {
  title: 'Paper Q&A', askSelection: 'Ask about selection', history: 'Conversations', newSession: 'New conversation',
  back: 'Back to conversation', currentPaper: 'Current paper', onlyPaper: 'Only this paper', scope: 'Reading scope',
  pre_experiments: 'Before experiments', body: 'Full main text', full: 'Full text with appendices',
  scopeNote: 'Text already added stays in this conversation. Start a new conversation to use a smaller scope.',
  preparing: 'Preparing the paper text…', empty: 'What would you like to understand about this paper?',
  emptyHint: 'Ask about a method, an equation or an experiment. You can also select text in the PDF.',
  placeholder: 'Ask a question about this paper', inputLabel: 'Question about the current paper',
  send: 'Send', stop: 'Stop', retry: 'Retry', copying: 'Copied', copy: 'Copy answer', copyFailed: 'Could not copy. Select the answer to copy it.',
  shortcut: 'Shift + Enter for a new line', you: 'You', answering: 'Answering…', cancelled: 'Stopped. Text received so far is kept.',
  partial: 'The supplied text supports only part of this answer.', insufficient: 'The available text cannot support a complete answer.', sessionUsage: 'Conversation usage', usageIncomplete: 'Some requests did not report usage; these counts may be incomplete.',
  interrupted: 'This answer is incomplete.', error: 'The answer could not be completed.',
  selectedText: 'Selected text', clearSelection: 'Remove selected text', page: 'Page {page}',
  source: 'View original source {source}', sourcePending: 'Sources become available when the answer is complete.',
  caution: 'Check the original sources when a detail matters.', usage: 'Recorded usage', inputTokens: 'Input tokens',
  outputTokens: 'Output tokens', cacheHit: 'Cached input', cacheMiss: 'Uncached input', usageMissing: 'Usage was not reported.',
  local: 'Conversations are saved on this device for this paper.', noSessions: 'No conversations for this paper yet.',
  untitled: 'New conversation', deleteSession: 'Delete conversation', deleteConfirm: 'Delete this conversation? This cannot be undone.',
  delete: 'Delete', keep: 'Keep', selectedSession: 'Current conversation', scopeCurrent: 'Current requested scope',
} as const;
const zh: Record<keyof typeof en, string> = {
  title: '论文问答', askSelection: '选区提问', history: '本篇对话', newSession: '新对话',
  back: '返回对话', currentPaper: '当前论文', onlyPaper: '仅当前论文', scope: '输入范围',
  pre_experiments: '实验之前', body: '正文全文', full: '全文含附录',
  scopeNote: '本会话已加入的原文不会移除；新建对话可使用更小的范围。',
  preparing: '正在准备论文原文…', empty: '这篇论文有哪些地方想进一步理解？',
  emptyHint: '可以询问方法、公式或实验，也可以在 PDF 中选中文字后提问。',
  placeholder: '对这篇论文有什么疑问？', inputLabel: '向当前论文提问',
  send: '发送', stop: '停止', retry: '重试', copying: '已复制', copy: '复制回答', copyFailed: '复制失败，可选中回答文字复制。',
  shortcut: 'Shift + Enter 换行', you: '你', answering: '正在回答…', cancelled: '已停止，保留已收到的文字。',
  partial: '当前原文仅支持部分回答。', insufficient: '当前材料无法支持完整回答。', sessionUsage: '本篇对话用量', usageIncomplete: '部分请求未返回用量，当前统计可能不完整。',
  interrupted: '此回答尚未完成。', error: '未能完成回答。',
  selectedText: '已选原文', clearSelection: '移除已选原文', page: '第 {page} 页',
  source: '查看原文来源 {source}', sourcePending: '回答完成后可查看原文来源。',
  caution: '重要细节请点击来源核对原文。', usage: '已记录用量', inputTokens: '输入 token',
  outputTokens: '输出 token', cacheHit: '缓存命中输入', cacheMiss: '未命中输入', usageMissing: '服务商未报告用量。',
  local: '对话按论文保存在本机。', noSessions: '这篇论文还没有对话。',
  untitled: '新对话', deleteSession: '删除对话', deleteConfirm: '删除这段对话？删除后无法恢复。',
  delete: '删除', keep: '保留', selectedSession: '当前对话', scopeCurrent: '当前选择的输入范围',
};
export type QaLabelKey = keyof typeof en;
export function qaLabel(locale: string, key: QaLabelKey, values: Record<string, string | number> = {}): string {
  const dictionary = locale.toLowerCase().startsWith('zh') ? zh : en;
  return dictionary[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]));
}
