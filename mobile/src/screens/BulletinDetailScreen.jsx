import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Banner, Button, Card, Divider, Screen, Text } from '../components';
import { useTheme } from '../theme';
import { formatDate, initialsOf, joinPlace } from '../utils/format';

function DetailRow({ icon, label, value }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.spacing.md, paddingVertical: theme.spacing.md }]}>
      <Ionicons name={icon} size={18} color={theme.colors.textMuted} />
      <Text variant="small" tone="muted" style={{ width: 96 }}>
        {label}
      </Text>
      <Text variant="smallStrong" style={{ flex: 1 }}>
        {value || '—'}
      </Text>
    </View>
  );
}

export default function BulletinDetailScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute();
  const bulletin = params?.bulletin;

  if (!bulletin) {
    return (
      <Screen edges={{ top: false, bottom: true }}>
        <Banner tone="warning" title="Bulletin unavailable" message="Go back and open the bulletin again." />
      </Screen>
    );
  }

  return (
    <Screen
      edges={{ top: false, bottom: false }}
      footer={
        <View style={{ gap: theme.spacing.md }}>
          <Button
            label="I have seen this child"
            icon="camera"
            onPress={() => navigation.navigate('Tabs', { screen: 'Report' })}
            fullWidth
          />
          <Button label="Call Childline 1098" icon="call-outline" variant="secondary" onPress={() => Linking.openURL('tel:1098')} fullWidth />
        </View>
      }
    >
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill }]}>
          <Text variant="display" color={theme.colors.primarySoftText}>
            {initialsOf(bulletin.childName)}
          </Text>
        </View>
        <Text variant="title" style={{ marginTop: theme.spacing.lg, textAlign: 'center' }}>
          {bulletin.childName}
        </Text>
        <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
          {[bulletin.age != null ? `${bulletin.age} years` : 'Age unknown', bulletin.gender].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <Card style={{ marginTop: theme.spacing.xl }} padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <DetailRow icon="location-outline" label="Last seen" value={bulletin.lastSeen || joinPlace(bulletin.district, bulletin.state)} />
          <Divider />
          <DetailRow icon="calendar-outline" label="Missing since" value={formatDate(bulletin.dateOfMissing)} />
          <Divider />
          <DetailRow icon="business-outline" label="Published by" value={bulletin.agency} />
          <Divider />
          <DetailRow icon="time-outline" label="Published" value={formatDate(bulletin.publishedAt)} />
        </View>
      </Card>

      <Banner
        tone="info"
        icon="information-circle"
        title="If you have information"
        message={bulletin.instructions || 'Submit a sighting through Khozo or contact 1098 / your local police station.'}
        style={{ marginTop: theme.spacing.lg }}
      />

      <Banner
        tone="warning"
        icon="shield-half-outline"
        title="Please do not share screenshots"
        message="Circulating a child's photo outside official channels can put them at greater risk. Report through Khozo instead."
        style={{ marginTop: theme.spacing.md }}
      />

      <View style={{ height: theme.spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center' },
});
