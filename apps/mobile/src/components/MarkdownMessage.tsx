import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type Props = {
  content: string;
  streaming?: boolean;
  tone?: 'assistant' | 'user';
};

type Block =
  | { kind: 'code'; value: string }
  | { kind: 'divider' }
  | { kind: 'heading'; level: number; value: string }
  | { kind: 'quote'; value: string[] }
  | { kind: 'list'; ordered: boolean; value: string[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'paragraph'; value: string[] };

const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function MarkdownMessage({ content, streaming = false, tone = 'assistant' }: Props) {
  if (streaming) {
    return (
      <Text selectable style={[styles.body, tone === 'user' && styles.userBody]}>
        {streamingPlainText(content) || ' '}
      </Text>
    );
  }
  return (
    <View>
      {parseMarkdownBlocks(content).map((block, index) => (
        <MarkdownBlock block={block} key={`${block.kind}-${index}`} tone={tone} />
      ))}
    </View>
  );
}

export function streamingPlainText(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^[ \t]{0,3}#{1,3}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gm, '')
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^[ \t]*\|[ \t]*/gm, '')
    .replace(/[ \t]*\|[ \t]*$/gm, '')
    .replace(/[ \t]*\|[ \t]*/g, '  ');
}

function MarkdownBlock({ block, tone }: { block: Block; tone: Props['tone'] }) {
  if (block.kind === 'divider') return <View style={styles.divider} />;
  if (block.kind === 'code') {
    return (
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator style={styles.codeScroll}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text selectable style={styles.code}>
            {block.value}
          </Text>
        </ScrollView>
      </ScrollView>
    );
  }
  if (block.kind === 'heading') {
    return (
      <Text selectable style={[styles.heading, block.level === 1 && styles.headingOne]}>
        {inline(block.value, tone)}
      </Text>
    );
  }
  if (block.kind === 'quote') {
    return (
      <Text selectable style={styles.quote}>
        {block.value.map((line, index) => (
          <Text key={index}>
            {inline(line, tone)}
            {index < block.value.length - 1 ? '\n' : ''}
          </Text>
        ))}
      </Text>
    );
  }
  if (block.kind === 'list') {
    return (
      <View style={styles.list}>
        {block.value.map((line, index) => (
          <View key={`${line}-${index}`} style={styles.listRow}>
            <Text style={styles.marker}>{block.ordered ? `${index + 1}.` : '•'}</Text>
            <Text selectable style={[styles.body, styles.listBody]}>
              {inline(line, tone)}
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.kind === 'table') {
    const [header, ...rows] = block.rows;
    return (
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator style={styles.tableScroll}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.table}>
            {header ? <TableRow cells={header} header /> : null}
            {rows.map((row, index) => (
              <TableRow cells={row} key={index} />
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    );
  }
  return (
    <Text selectable style={[styles.body, tone === 'user' && styles.userBody]}>
      {block.value.map((line, index) => (
        <Text key={index}>
          {inline(line, tone)}
          {index < block.value.length - 1 ? '\n' : ''}
        </Text>
      ))}
    </Text>
  );
}

function TableRow({ cells, header = false }: { cells: string[]; header?: boolean }) {
  return (
    <View style={[styles.tableRow, header && styles.tableHeader]}>
      {cells.map((cell, index) => (
        <Text key={index} selectable style={[styles.tableCell, header && styles.tableHeaderText]}>
          {inline(cell, 'assistant')}
        </Text>
      ))}
    </View>
  );
}

function inline(value: string, tone: Props['tone']) {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return (
        <Text key={index} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <Text key={index} style={styles.inlineCode}>
          {part.slice(1, -1)}
        </Text>
      );
    const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) {
      return (
        <Text key={index} onPress={() => void Linking.openURL(link[2] ?? '')} style={styles.link}>
          {link[1]}
        </Text>
      );
    }
    return (
      <Text key={index} style={tone === 'user' ? styles.userBody : undefined}>
        {part}
      </Text>
    );
  });
}

export function parseMarkdownBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('```'))
        code.push(lines[index++] ?? '');
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', value: code.join('\n') });
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ kind: 'divider' });
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, value: heading[2] ?? '' });
      index += 1;
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? '').startsWith('>'))
        quote.push((lines[index++] ?? '').replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', value: quote });
      continue;
    }
    if (
      index + 1 < lines.length &&
      line.includes('|') &&
      TABLE_DIVIDER.test(lines[index + 1] ?? '')
    ) {
      const rows = [splitTableRow(line)];
      index += 2;
      while (
        index < lines.length &&
        (lines[index] ?? '').includes('|') &&
        (lines[index] ?? '').trim()
      )
        rows.push(splitTableRow(lines[index++] ?? ''));
      blocks.push({ kind: 'table', rows });
      continue;
    }
    const list = line.match(/^\s*((\d+)\.|[-*+])\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]);
      const values: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*((\d+)\.|[-*+])\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        values.push(item[3] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, value: values });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? '').trim()) {
      const next = lines[index] ?? '';
      if (
        paragraph.length &&
        (/^(#{1,3})\s+/.test(next) ||
          next.startsWith('```') ||
          next.startsWith('>') ||
          /^\s*((\d+)\.|[-*+])\s+/.test(next))
      )
        break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', value: paragraph });
  }
  return blocks.length ? blocks : [{ kind: 'paragraph', value: [' '] }];
}

function splitTableRow(value: string) {
  return value
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

const styles = StyleSheet.create({
  body: {
    color: colors.text,
    fontFamily: Platform.select({ android: 'sans-serif', default: undefined }),
    fontSize: 16,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  userBody: { color: colors.text },
  heading: {
    color: colors.text,
    fontFamily: Platform.select({ android: 'sans-serif-medium', default: undefined }),
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 25,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  headingOne: { fontSize: 20, lineHeight: 29 },
  bold: {
    fontFamily: Platform.select({ android: 'sans-serif-medium', default: undefined }),
    fontWeight: '700',
  },
  inlineCode: {
    backgroundColor: colors.mutedSurface,
    fontFamily: Platform.select({ android: 'monospace', default: undefined }),
    fontSize: 13,
  },
  link: { color: colors.brand, textDecorationLine: 'underline' },
  codeScroll: {
    backgroundColor: '#EEF2F1',
    borderRadius: 6,
    marginBottom: spacing.sm,
    maxHeight: 144,
    maxWidth: '100%',
  },
  code: {
    color: colors.text,
    fontFamily: Platform.select({ android: 'monospace', default: undefined }),
    fontSize: 12,
    lineHeight: 19,
    padding: spacing.sm,
  },
  divider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.md,
  },
  quote: {
    borderLeftColor: colors.brand,
    borderLeftWidth: 2,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: spacing.sm,
    paddingLeft: spacing.sm,
  },
  list: { marginBottom: spacing.sm },
  listRow: { flexDirection: 'row', marginBottom: 3 },
  listBody: { flex: 1, flexShrink: 1, minWidth: 0 },
  marker: {
    color: colors.brand,
    fontFamily: Platform.select({ android: 'sans-serif-medium', default: undefined }),
    lineHeight: 24,
    marginRight: spacing.sm,
    minWidth: 18,
  },
  tableScroll: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
    maxHeight: 168,
    maxWidth: '100%',
  },
  table: { minWidth: '100%' },
  tableRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  tableHeader: { backgroundColor: colors.mutedSurface },
  tableCell: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    minWidth: 116,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  tableHeaderText: {
    fontFamily: Platform.select({ android: 'sans-serif-medium', default: undefined }),
    fontWeight: '700',
  },
});
