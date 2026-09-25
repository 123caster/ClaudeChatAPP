import { render } from '@testing-library/react-native';
import { createElement } from 'react';
import { StyleSheet } from 'react-native';

import {
  MarkdownMessage,
  parseMarkdownBlocks,
  streamingPlainText,
} from '@/components/MarkdownMessage';

describe('parseMarkdownBlocks', () => {
  it('recognizes headings, rich text paragraphs, and a GFM table', () => {
    expect(
      parseMarkdownBlocks(
        '# 进度\n\n**完成** `mysql`\n\n| 项目 | 状态 |\n| --- | --- |\n| Markdown | 已渲染 |',
      ),
    ).toEqual([
      { kind: 'heading', level: 1, value: '进度' },
      { kind: 'paragraph', value: ['**完成** `mysql`'] },
      {
        kind: 'table',
        rows: [
          ['项目', '状态'],
          ['Markdown', '已渲染'],
        ],
      },
    ]);
  });

  it('keeps fenced code and lists as dedicated mobile blocks', () => {
    expect(parseMarkdownBlocks('```sql\nSELECT 1;\n```\n\n- 第一项\n- 第二项')).toEqual([
      { kind: 'code', value: 'SELECT 1;' },
      { kind: 'list', ordered: false, value: ['第一项', '第二项'] },
    ]);
  });
});

describe('streamingPlainText', () => {
  it('keeps partial replies stable without exposing common Markdown markers', () => {
    expect(
      streamingPlainText(
        '# 标题\n\n**重点**\n\n- 第一项\n\n| 场景 | 结果 |\n| --- | --- |\n| 索引 | 快 |',
      ),
    ).toBe('标题\n\n重点\n\n• 第一项\n\n场景  结果\n\n索引  快');
  });
});

describe('MarkdownMessage layout', () => {
  it('shrinks long list text inside the available message width', async () => {
    const screen = await render(
      createElement(MarkdownMessage, {
        content: '- 这是一条很长的定时任务结果，必须在手机右侧边界以内自动换行',
      }),
    );

    const inlineText = screen.getByText(
      '这是一条很长的定时任务结果，必须在手机右侧边界以内自动换行',
    );
    expect(StyleSheet.flatten(inlineText.parent?.props.style)).toMatchObject({
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
    });
  });
});
