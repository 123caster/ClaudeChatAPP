import type { Schedule, ScheduledTaskDraft } from '@claude-chat/protocol';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ProjectPicker } from '@/components/ProjectPicker';
import { WorkingDirectoryPicker } from '@/components/WorkingDirectoryPicker';
import { useModels } from '@/state/model-store';
import { useScheduledTasks } from '@/state/scheduled-task-store';
import { useSessions } from '@/state/session-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type ScheduleKind = Schedule['kind'];

const kinds: Array<{ value: ScheduleKind; label: string }> = [
  { value: 'once', label: '一次' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
];

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];

export function ScheduledTaskEditorScreen({
  taskId,
  initialDraft,
}: {
  taskId?: string;
  initialDraft?: ScheduledTaskDraft;
}) {
  const taskStore = useScheduledTasks();
  const sessionStore = useSessions();
  const modelStore = useModels();
  const existing = taskId ? taskStore.tasks.find(({ id }) => id === taskId) : null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  const [name, setName] = useState(initialDraft?.name ?? '');
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? '');
  const [kind, setKind] = useState<ScheduleKind>(initialDraft?.schedule?.kind ?? 'daily');
  const [hour, setHour] = useState(String(initialDraft?.schedule?.hour ?? 9));
  const [minute, setMinute] = useState(String(initialDraft?.schedule?.minute ?? 0));
  const [localDate, setLocalDate] = useState(
    initialDraft?.schedule?.kind === 'once'
      ? initialDraft.schedule.localDate
      : new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );
  const [weekday, setWeekday] = useState(
    initialDraft?.schedule?.kind === 'weekly' ? initialDraft.schedule.weekday : 1,
  );
  const [monthDay, setMonthDay] = useState(
    String(initialDraft?.schedule?.kind === 'monthly' ? initialDraft.schedule.day : 1),
  );
  const [selectedTimeZone, setSelectedTimeZone] = useState(initialDraft?.timeZone ?? timeZone);
  const [projectId, setProjectId] = useState<string | null>(initialDraft?.projectId ?? null);
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(
    initialDraft?.workingDirectory ?? null,
  );
  const [modelId, setModelId] = useState<string | null>(initialDraft?.modelId ?? null);
  const [allowAutoWrite, setAllowAutoWrite] = useState(initialDraft?.allowAutoWrite ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedTaskId = useRef<string | null>(null);

  useEffect(() => {
    if (existing && initializedTaskId.current !== existing.id) {
      initializedTaskId.current = existing.id;
      setName(existing.name);
      setPrompt(existing.prompt);
      setKind(existing.schedule.kind);
      setHour(String(existing.schedule.hour));
      setMinute(String(existing.schedule.minute));
      if (existing.schedule.kind === 'once') setLocalDate(existing.schedule.localDate);
      if (existing.schedule.kind === 'weekly') setWeekday(existing.schedule.weekday);
      if (existing.schedule.kind === 'monthly') setMonthDay(String(existing.schedule.day));
      setSelectedTimeZone(existing.timeZone);
      setProjectId(existing.projectId);
      setWorkingDirectory(existing.workingDirectory);
      setModelId(existing.modelId);
      setAllowAutoWrite(existing.allowAutoWrite);
    } else if (!taskId && !initialDraft?.projectId && sessionStore.projects.length === 1) {
      setProjectId((current) => current ?? sessionStore.projects[0]?.id ?? null);
    }
  }, [existing, initialDraft?.projectId, sessionStore.projects, taskId]);

  const schedule = useMemo<Schedule | null>(() => {
    const parsedHour = Number(hour);
    const parsedMinute = Number(minute);
    if (
      !Number.isInteger(parsedHour) ||
      parsedHour < 0 ||
      parsedHour > 23 ||
      !Number.isInteger(parsedMinute) ||
      parsedMinute < 0 ||
      parsedMinute > 59
    ) {
      return null;
    }
    if (kind === 'once') {
      return /^\d{4}-\d{2}-\d{2}$/.test(localDate)
        ? { kind, localDate, hour: parsedHour, minute: parsedMinute }
        : null;
    }
    if (kind === 'weekly') return { kind, weekday, hour: parsedHour, minute: parsedMinute };
    if (kind === 'monthly') {
      const day = Number(monthDay);
      return Number.isInteger(day) && day >= 1 && day <= 31
        ? { kind, day, hour: parsedHour, minute: parsedMinute }
        : null;
    }
    return { kind, hour: parsedHour, minute: parsedMinute };
  }, [hour, kind, localDate, minute, monthDay, weekday]);

  const canSave = Boolean(
    name.trim() && prompt.trim() && schedule && projectId && selectedTimeZone,
  );

  const submit = async () => {
    if (!canSave || !schedule || !projectId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        prompt: prompt.trim(),
        schedule,
        timeZone: selectedTimeZone.trim(),
        projectId,
        workingDirectory,
        modelId,
        allowAutoWrite,
      };
      const task = taskId ? await taskStore.update(taskId, input) : await taskStore.create(input);
      router.replace({ pathname: '/scheduled/[taskId]', params: { taskId: task.id } });
    } catch {
      setError('保存失败，请检查时间、项目和 Gateway 连接。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.page}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="返回"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{taskId ? '编辑定时任务' : '新建定时任务'}</Text>
        <View style={styles.iconButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>名称</Text>
        <TextInput
          maxLength={120}
          onChangeText={setName}
          placeholder="例如 每日项目摘要"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={name}
        />
        <Text style={styles.label}>任务内容</Text>
        <TextInput
          multiline
          onChangeText={setPrompt}
          placeholder="告诉 Claude 到点后要完成什么"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.prompt]}
          textAlignVertical="top"
          value={prompt}
        />
        <Text style={styles.label}>执行周期</Text>
        <View style={styles.segmented}>
          {kinds.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setKind(item.value)}
              style={[styles.segment, kind === item.value && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, kind === item.value && styles.segmentTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {kind === 'once' ? (
          <>
            <Text style={styles.label}>日期</Text>
            <TextInput
              inputMode="numeric"
              onChangeText={setLocalDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={localDate}
            />
          </>
        ) : null}
        {kind === 'weekly' ? (
          <View style={styles.weekdays}>
            {weekdayLabels.map((label, index) => (
              <Pressable
                key={label}
                onPress={() => setWeekday(index + 1)}
                style={[styles.weekday, weekday === index + 1 && styles.weekdayActive]}
              >
                <Text
                  style={[styles.weekdayText, weekday === index + 1 && styles.weekdayTextActive]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {kind === 'monthly' ? (
          <>
            <Text style={styles.label}>每月日期</Text>
            <TextInput
              inputMode="numeric"
              onChangeText={setMonthDay}
              style={styles.input}
              value={monthDay}
            />
          </>
        ) : null}
        <Text style={styles.label}>时间</Text>
        <View style={styles.timeRow}>
          <TextInput
            inputMode="numeric"
            maxLength={2}
            onChangeText={setHour}
            style={styles.timeInput}
            value={hour}
          />
          <Text style={styles.timeSeparator}>:</Text>
          <TextInput
            inputMode="numeric"
            maxLength={2}
            onChangeText={setMinute}
            style={styles.timeInput}
            value={minute}
          />
          <TextInput
            onChangeText={setSelectedTimeZone}
            style={[styles.input, styles.zone]}
            value={selectedTimeZone}
          />
        </View>
        <Text style={styles.label}>项目</Text>
        <ProjectPicker
          onSelect={(next) => {
            setProjectId(next);
            setWorkingDirectory(null);
          }}
          projects={sessionStore.projects}
          selectedId={projectId}
        />
        {projectId ? (
          <WorkingDirectoryPicker
            projectId={projectId}
            value={workingDirectory}
            onChange={setWorkingDirectory}
          />
        ) : null}
        <Text style={styles.label}>模型</Text>
        <Pressable
          onPress={() => setModelId(null)}
          style={[styles.option, modelId === null && styles.optionActive]}
        >
          <Text style={styles.optionText}>跟随 Gateway 默认模型</Text>
        </Pressable>
        {modelStore.models.map((model) => (
          <Pressable
            key={model.id}
            onPress={() => setModelId(model.id)}
            style={[styles.option, modelId === model.id && styles.optionActive]}
          >
            <Text style={styles.optionText}>
              {model.name} · {model.model}
            </Text>
          </Pressable>
        ))}
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchTitle}>允许自动写入</Text>
            <Text style={styles.switchDescription}>
              仅允许在工作目录内 Write/Edit；危险操作仍需手机确认。
            </Text>
          </View>
          <Switch
            onValueChange={setAllowAutoWrite}
            trackColor={{ false: colors.border, true: colors.brand }}
            value={allowAutoWrite}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          disabled={!canSave || busy}
          onPress={() => void submit()}
          style={[styles.save, (!canSave || busy) && styles.disabled]}
        >
          {busy ? <ActivityIndicator color={colors.textOnBrand} /> : null}
          <Text style={styles.saveText}>{busy ? '保存中' : taskId ? '保存修改' : '创建任务'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 58,
  },
  iconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 54 },
  back: { color: colors.text, fontSize: 36, lineHeight: 40 },
  headerTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  content: { padding: spacing.md, paddingBottom: 48 },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 7,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 48,
    paddingHorizontal: spacing.control,
  },
  prompt: { minHeight: 132, paddingTop: spacing.control },
  segmented: {
    backgroundColor: colors.mutedSurface,
    borderRadius: 6,
    flexDirection: 'row',
    padding: 3,
  },
  segment: { alignItems: 'center', borderRadius: 4, flex: 1, paddingVertical: 9 },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { color: colors.muted, fontSize: 12 },
  segmentTextActive: { color: colors.brand, fontWeight: '600' },
  weekdays: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  weekday: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 5,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  weekdayActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  weekdayText: { color: colors.text, fontSize: 13 },
  weekdayTextActive: { color: colors.textOnBrand },
  timeRow: { alignItems: 'center', flexDirection: 'row' },
  timeInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.text,
    fontSize: 17,
    height: 48,
    textAlign: 'center',
    width: 58,
  },
  timeSeparator: { color: colors.text, fontSize: 20, marginHorizontal: 6 },
  zone: { flex: 1, marginLeft: spacing.control },
  option: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 6,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: spacing.control,
  },
  optionActive: { borderColor: colors.brand },
  optionText: { color: colors.text, fontSize: 13 },
  switchRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.md,
    padding: spacing.md,
  },
  switchCopy: { flex: 1, paddingRight: spacing.md },
  switchTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  switchDescription: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.md },
  save: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    flexDirection: 'row',
    height: 50,
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  saveText: { color: colors.textOnBrand, fontSize: 15, fontWeight: '600', marginLeft: 7 },
  disabled: { opacity: 0.4 },
});
