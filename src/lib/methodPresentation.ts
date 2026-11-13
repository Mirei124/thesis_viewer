/** Shared by every method-generation path, including optional semantic review. */
export const METHOD_PRESENTATION_INSTRUCTION = '方法输出按原文实际步骤或模块分段，不得把整条方法写成一个长段落。开头用一句说明输入和最终输出并单独成段；随后每个核心步骤或模块各用一个短段落，段首用Markdown加粗的简短名称，再解释其定义、处理与衔接。确有先后顺序时可用有序列表，并列模块可用无序列表；不要虚构固定步骤数，不把并列模块写成时序，不为分段增加细节或篇幅。段落之间保留空行，在JSON text字符串中用\\n\\n转义，最终展示应有真实换行；不要把整个JSON包在Markdown代码围栏中。';
