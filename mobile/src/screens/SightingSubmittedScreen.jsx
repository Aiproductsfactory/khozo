import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Badge, Banner, Button, Card, Screen, Text } from '../components';
import { useTheme } from '../theme';
import { statusMeta } from '../utils/format';

/** What the reporter should expect next, per server-side sighting status. */
const NEXT_STEPS = {
  pending_review: [
    'An authorised officer reviews the possible match.',
    'If it is confirmed, the family and the responsible police station are contacted.',
    'You will not be told the child\'s identity — that is protected by law.',
  ],
  no_match: [
    'No missing-child record matched this report yet.',
    'It has been queued for Childline / CWC follow-up.',
    'New missing-child reports are checked against it as they arrive.',
  ],
};

export default function SightingSubmittedScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute();
  const queued = params?.queued;
  const report = params?.result?.foundReport;
  const review = params?.result?.review;
  const status = report?.status;
  const meta = status ? statusMeta(status) : null;
  const steps = NEXT_STEPS[status] || NEXT_STEPS.no_match;

  const copyId = useCallback(() => {
    if (report?.id) Clipboard.setStringAsync(report.id).catch(() => {});
  }, [report]);

  const done = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  }, [navigation]);

  return (
    <Screen edges={{ top: false, bottom: false }} footer={<Button label="Done" onPress={done} fullWidth />}>
      <View style={styles.center}>
        <View
          style={[
            styles.tick,
            { backgroundColor: queued ? theme.colors.warningSoft : theme.colors.successSoft, borderRadius: theme.radius.pill },
          ]}
        >
          <Ionicons
            name={queued ? 'cloud-upload' : 'checkmark-circle'}
            size={44}
            color={queued ? theme.colors.warning : theme.colors.success}
          />
        </View>
        <Text variant="title" style={{ marginTop: theme.spacing.lg, textAlign: 'center' }}>
          {queued ? 'Saved on your phone' : 'Thank you — report received'}
        </Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.sm, textAlign: 'center' }}>
          {queued
            ? 'You are offline or the server could not be reached. Khozo will send this report automatically as soon as you have a connection.'
            : review || 'Your report has been received and queued for review.'}
        </Text>
      </View>

      {report?.id ? (
        <Card style={{ marginTop: theme.spacing.xl }}>
          <Text variant="caption" tone="muted">
            Your receipt number
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy receipt number ${report.id}`}
            accessibilityHint="Copies the receipt number to the clipboard"
            onPress={copyId}
            style={[styles.idRow, { marginTop: theme.spacing.sm, gap: theme.spacing.md }]}
          >
            <Text variant="heading" style={{ flex: 1 }}>
              {report.id}
            </Text>
            <Ionicons name="copy-outline" size={20} color={theme.colors.primary} />
          </Pressable>
          <Text variant="small" tone="muted" style={{ marginTop: theme.spacing.sm }}>
            Keep this to check the status later from the Track tab.
          </Text>
          {meta ? <Badge label={meta.label} tone={meta.tone} style={{ marginTop: theme.spacing.md }} /> : null}
        </Card>
      ) : null}

      {queued ? (
        <Banner
          tone="info"
          icon="information-circle"
          title="Nothing is lost"
          message={params?.reason ? `Reason: ${params.reason}` : 'The report, photo and location are stored safely on this device.'}
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : (
        <Card style={{ marginTop: theme.spacing.lg }}>
          <Text variant="caption" tone="muted">
            What happens next
          </Text>
          <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.md }}>
            {steps.map((line, index) => (
              <View key={line} style={[styles.stepRow, { gap: theme.spacing.md }]}>
                <View style={[styles.stepNum, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill }]}>
                  <Text variant="caption" color={theme.colors.primarySoftText}>
                    {index + 1}
                  </Text>
                </View>
                <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                  {line}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      <Banner
        tone="danger"
        icon="call"
        title="If the child is in immediate danger"
        message="Call 112 (emergency) or 1098 (Childline) right now. Do not wait for this report to be reviewed."
        style={{ marginTop: theme.spacing.lg }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingTop: 24 },
  tick: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  idRow: { flexDirection: 'row', alignItems: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
