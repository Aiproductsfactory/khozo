import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Card, CheckField, ChoiceField, Screen, StateField, Text, TextField } from '../components';
import { ApiError, submitSighting } from '../services/api';
import { useAuth } from '../services/auth';
import { useOutbox } from '../services/outbox';
import { useTheme } from '../theme';

const STEPS = ['Photo', 'Details', 'Confirm'];

const GENDERS = [
  { label: 'Male', value: 'Male' },
  { label: 'Female', value: 'Female' },
  { label: 'Other', value: 'Other' },
];

const EMPTY = {
  photoUri: null,
  foundLocation: '',
  note: '',
  ageApprox: '',
  gender: null,
  state: '',
  district: '',
  lat: null,
  lng: null,
  accuracy: null,
  reporterName: '',
  reporterPhone: '',
  confidentialReporter: false,
  consent: false,
};

/** Downscales and re-encodes so uploads stay small enough for a weak field connection. */
async function preparePhoto(uri) {
  try {
    const result = await manipulateAsync(uri, [{ resize: { width: 1280 } }], {
      compress: 0.7,
      format: SaveFormat.JPEG,
    });
    return result.uri;
  } catch {
    return uri;
  }
}

function StepIndicator({ index }) {
  const theme = useTheme();
  return (
    <View style={[styles.steps, { gap: theme.spacing.sm, marginBottom: theme.spacing.lg }]}>
      {STEPS.map((label, i) => {
        const active = i === index;
        const done = i < index;
        return (
          <View key={label} style={styles.step}>
            <View
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: done || active ? theme.colors.primary : theme.colors.surfaceSunken,
              }}
            />
            <Text variant="caption" tone={active ? 'primary' : done ? 'secondary' : 'muted'} style={{ marginTop: 6 }}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function CameraModal({ visible, onClose, onCapture }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef(null);
  const [facing, setFacing] = useState('back');
  const [busy, setBusy] = useState(false);

  const capture = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      const prepared = await preparePhoto(photo.uri);
      onCapture(prepared);
      onClose();
    } catch {
      Alert.alert('Could not take the photo', 'Please try again, or pick an existing photo from your gallery.');
    } finally {
      setBusy(false);
    }
  }, [busy, onCapture, onClose]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.cameraRoot}>
        {visible ? <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} /> : null}

        <View style={[styles.cameraTop, { paddingTop: insets.top + theme.spacing.md }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={onClose} style={styles.cameraChip}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.cameraHint}>
            <Text variant="small" color="#FFFFFF">
              Frame the child's face clearly. Do not approach if unsafe.
            </Text>
          </View>
        </View>

        <View style={[styles.cameraBottom, { paddingBottom: insets.bottom + theme.spacing.xl }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch camera"
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            style={styles.cameraChip}
          >
            <Ionicons name="camera-reverse" size={22} color="#FFFFFF" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            onPress={capture}
            disabled={busy}
            style={styles.shutter}
          >
            {busy ? <ActivityIndicator color="#111" /> : <View style={styles.shutterInner} />}
          </Pressable>
          <View style={styles.cameraChipPlaceholder} />
        </View>
      </View>
    </Modal>
  );
}

export default function ReportSightingScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { token } = useAuth();
  const { online, enqueue, rememberReceipt } = useOutbox();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [cameraOpen, setCameraOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const set = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, []);

  const reset = useCallback(() => {
    setForm(EMPTY);
    setErrors({});
    setStep(0);
  }, []);

  const openCamera = useCallback(async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera permission needed',
          'Khozo needs the camera to attach a photo. You can still submit a report describing the child without a photo.',
        );
        return;
      }
    }
    setCameraOpen(true);
  }, [permission, requestPermission]);

  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const prepared = await preparePhoto(result.assets[0].uri);
    set('photoUri', prepared);
  }, [set]);

  const captureLocation = useCallback(async () => {
    setLocating(true);
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        Alert.alert('Location permission needed', 'Allow location so the nearest team can be dispatched, or type the place manually.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude, accuracy } = position.coords;
      setForm((prev) => ({ ...prev, lat: latitude, lng: longitude, accuracy }));

      // Reverse geocoding fills state/district, which the server uses to route
      // the sighting to the right jurisdiction.
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (place) {
          setForm((prev) => ({
            ...prev,
            state: prev.state || place.region || '',
            district: prev.district || place.subregion || place.city || '',
            foundLocation:
              prev.foundLocation ||
              [place.name, place.street, place.district, place.city].filter(Boolean).slice(0, 2).join(', '),
          }));
        }
      } catch {
        // Coordinates alone are still useful.
      }
    } catch {
      Alert.alert('Could not get location', 'Move to an open area and try again, or type the place manually.');
    } finally {
      setLocating(false);
    }
  }, []);

  // Offer location capture as soon as the reporter reaches the details step.
  useEffect(() => {
    if (step === 1 && form.lat == null && !locating) captureLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const validateStep = useCallback(
    (index) => {
      const next = {};
      if (index === 1) {
        if (!form.photoUri && !form.note.trim() && !form.foundLocation.trim()) {
          next.foundLocation = 'Add a photo, a place, or a description so the report can be acted on';
        }
        const age = form.ageApprox.trim();
        if (age && (!/^\d{1,2}$/.test(age) || Number(age) > 18)) {
          next.ageApprox = 'Enter an approximate age between 0 and 18';
        }
      }
      if (index === 2) {
        const phone = form.reporterPhone.replace(/\D/g, '');
        if (form.reporterPhone.trim() && (phone.length < 7 || phone.length > 15)) {
          next.reporterPhone = 'Enter a valid mobile number (7-15 digits)';
        }
        if (!form.consent) {
          next.consent = 'Please confirm before submitting';
        }
      }
      setErrors(next);
      return Object.keys(next).length === 0;
    },
    [form],
  );

  const goNext = useCallback(() => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }, [step, validateStep]);

  const submit = useCallback(async () => {
    if (!validateStep(2)) return;
    setSubmitting(true);

    const payload = {
      photoUri: form.photoUri,
      foundLocation: form.foundLocation.trim() || 'Location not specified',
      note: form.note.trim(),
      ageApprox: form.ageApprox.trim(),
      gender: form.gender,
      state: form.state.trim(),
      district: form.district.trim(),
      lat: form.lat,
      lng: form.lng,
      reporterName: form.reporterName.trim(),
      reporterPhone: form.reporterPhone.replace(/\D/g, ''),
      confidentialReporter: form.confidentialReporter,
    };

    try {
      const result = await submitSighting(payload, { token });
      await rememberReceipt(result?.foundReport, payload);
      reset();
      navigation.navigate('SightingSubmitted', { result, queued: false });
    } catch (error) {
      // Anything that is not a validation rejection is worth queueing: the
      // reporter has already walked away from the child by now.
      const retryable = !(error instanceof ApiError) || error.isNetworkError || error.status >= 500 || error.status === 429;
      if (retryable) {
        await enqueue(payload);
        reset();
        navigation.navigate('SightingSubmitted', { queued: true, reason: error.message });
      } else {
        Alert.alert('Report not accepted', error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [form, token, enqueue, rememberReceipt, navigation, reset, validateStep]);

  const footer =
    step === STEPS.length - 1 ? (
      <Button label={online ? 'Submit report' : 'Save and send when online'} icon="send" loading={submitting} onPress={submit} fullWidth />
    ) : (
      <View style={[styles.footerRow, { gap: theme.spacing.md }]}>
        {step > 0 ? (
          <Button label="Back" variant="secondary" icon="arrow-back" onPress={() => setStep((s) => s - 1)} style={{ flex: 1 }} />
        ) : null}
        <Button
          label={step === 0 && !form.photoUri ? 'Continue without photo' : 'Continue'}
          icon="arrow-forward"
          iconPosition="right"
          onPress={goNext}
          style={{ flex: step > 0 ? 1.4 : 1 }}
        />
      </View>
    );

  return (
    <Screen
      title="Report a sighting"
      subtitle="Anyone can report. No account needed."
      edges={{ top: true, bottom: false }}
      footer={footer}
    >
      <StepIndicator index={step} />

      {step === 0 ? (
        <View style={{ gap: theme.spacing.lg }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={form.photoUri ? 'Replace photo' : 'Take a photo'}
            onPress={openCamera}
            style={({ pressed }) => [
              styles.photoBox,
              {
                backgroundColor: theme.colors.surface,
                borderColor: form.photoUri ? theme.colors.primary : theme.colors.borderStrong,
                borderRadius: theme.radius.lg,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            {form.photoUri ? (
              <Image source={{ uri: form.photoUri }} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={styles.photoEmpty}>
                <View style={[styles.photoIcon, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill }]}>
                  <Ionicons name="camera" size={28} color={theme.colors.primarySoftText} />
                </View>
                <Text variant="heading" style={{ marginTop: theme.spacing.md }}>
                  Take a photo
                </Text>
                <Text variant="small" tone="muted" style={{ marginTop: 4, textAlign: 'center' }}>
                  A clear face photo gives the best chance of a match
                </Text>
              </View>
            )}
          </Pressable>

          <View style={[styles.photoActions, { gap: theme.spacing.md }]}>
            <Button
              label={form.photoUri ? 'Retake' : 'Camera'}
              icon="camera-outline"
              variant="secondary"
              onPress={openCamera}
              style={{ flex: 1 }}
            />
            <Button label="Gallery" icon="images-outline" variant="secondary" onPress={pickFromGallery} style={{ flex: 1 }} />
            {form.photoUri ? (
              <Button label="Remove" icon="trash-outline" variant="ghost" onPress={() => set('photoUri', null)} style={{ flex: 1 }} />
            ) : null}
          </View>

          <Banner
            tone="info"
            icon="lock-closed"
            title="How this photo is used"
            message="It is compared against missing-child records and reviewed only by authorised police and CWC officers. You will never be shown the child's identity. Sighting photos are deleted after 180 days."
          />

          <Banner
            tone="warning"
            icon="warning"
            title="Stay safe"
            message="Do not confront anyone or try to move the child yourself. If the child is in immediate danger, call 112 or 1098 first."
          />
        </View>
      ) : null}

      {step === 1 ? (
        <View style={{ gap: theme.spacing.lg }}>
          <TextField
            label="Where did you see the child?"
            icon="location-outline"
            placeholder="e.g. Platform 3, Dadar station"
            value={form.foundLocation}
            onChangeText={(v) => set('foundLocation', v)}
            error={errors.foundLocation}
            required
          />

          <Card padded style={{ padding: theme.spacing.md }}>
            <View style={[styles.gpsRow, { gap: theme.spacing.md }]}>
              <Ionicons
                name={form.lat != null ? 'navigate-circle' : 'navigate-circle-outline'}
                size={22}
                color={form.lat != null ? theme.colors.success : theme.colors.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text variant="smallStrong">{form.lat != null ? 'GPS location attached' : 'GPS location'}</Text>
                <Text variant="small" tone="muted">
                  {locating
                    ? 'Getting your location…'
                    : form.lat != null
                      ? `${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}${form.accuracy ? ` · ±${Math.round(form.accuracy)} m` : ''}`
                      : 'Helps dispatch the nearest team'}
                </Text>
              </View>
              {locating ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <Button
                  label={form.lat != null ? 'Update' : 'Attach'}
                  size="sm"
                  variant={form.lat != null ? 'ghost' : 'soft'}
                  onPress={captureLocation}
                />
              )}
            </View>
          </Card>

          <TextField
            label="What did you notice?"
            placeholder="Clothing, who the child was with, direction they went, anything unusual…"
            value={form.note}
            onChangeText={(v) => set('note', v)}
            multiline
            hint="Details a reviewer can act on matter more than guesses."
          />

          <View style={[styles.inlineRow, { gap: theme.spacing.md }]}>
            <TextField
              label="Approx. age"
              placeholder="e.g. 8"
              keyboardType="number-pad"
              value={form.ageApprox}
              onChangeText={(v) => set('ageApprox', v.replace(/\D/g, '').slice(0, 2))}
              error={errors.ageApprox}
              style={{ flex: 1 }}
            />
            <View style={{ flex: 1.6 }}>
              <ChoiceField label="Gender" value={form.gender} options={GENDERS} onChange={(v) => set('gender', v)} />
            </View>
          </View>

          <View style={[styles.inlineRow, { gap: theme.spacing.md }]}>
            <TextField label="District" placeholder="e.g. Mumbai" value={form.district} onChangeText={(v) => set('district', v)} style={{ flex: 1 }} />
            <StateField value={form.state} onChange={(v) => set('state', v)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <Text variant="caption" tone="muted">
              Summary
            </Text>
            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
              <SummaryRow icon="image-outline" label="Photo" value={form.photoUri ? 'Attached' : 'Not attached'} />
              <SummaryRow icon="location-outline" label="Place" value={form.foundLocation.trim() || 'Not specified'} />
              <SummaryRow
                icon="navigate-outline"
                label="GPS"
                value={form.lat != null ? `${form.lat.toFixed(4)}, ${form.lng.toFixed(4)}` : 'Not attached'}
              />
              <SummaryRow
                icon="person-outline"
                label="Child"
                value={[form.ageApprox ? `~${form.ageApprox} yrs` : null, form.gender].filter(Boolean).join(' · ') || 'Not specified'}
              />
            </View>
          </Card>

          <TextField
            label="Your name"
            icon="person-outline"
            placeholder="Optional"
            value={form.reporterName}
            onChangeText={(v) => set('reporterName', v)}
            hint="Helps an officer follow up if they need more detail."
          />
          <TextField
            label="Your mobile number"
            icon="call-outline"
            placeholder="Optional"
            keyboardType="phone-pad"
            value={form.reporterPhone}
            onChangeText={(v) => set('reporterPhone', v)}
            error={errors.reporterPhone}
          />

          <CheckField
            label="Keep my identity confidential"
            description="Officers see the report but your name and number are hidden from the case record."
            value={form.confidentialReporter}
            onChange={(v) => set('confidentialReporter', v)}
          />

          <CheckField
            label="This report is true to the best of my knowledge"
            description="I consent to Khozo sharing it with police and child-protection authorities for verification. False reports can delay a real search."
            value={form.consent}
            onChange={(v) => set('consent', v)}
            error={errors.consent}
          />

          {!online ? (
            <Banner
              tone="warning"
              icon="cloud-offline"
              title="You are offline"
              message="The report will be saved on this phone and sent automatically once you have signal."
            />
          ) : null}
        </View>
      ) : null}

      <CameraModal visible={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(uri) => set('photoUri', uri)} />
      <View style={{ height: theme.spacing.xxl }} />
    </Screen>
  );
}

function SummaryRow({ icon, label, value }) {
  const theme = useTheme();
  return (
    <View style={[styles.summaryRow, { gap: theme.spacing.md }]}>
      <Ionicons name={icon} size={16} color={theme.colors.textMuted} />
      <Text variant="small" tone="muted" style={{ width: 60 }}>
        {label}
      </Text>
      <Text variant="smallStrong" style={{ flex: 1 }} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row' },
  step: { flex: 1 },
  photoBox: { height: 300, overflow: 'hidden', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
  photoEmpty: { alignItems: 'center', paddingHorizontal: 32 },
  photoIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  photoActions: { flexDirection: 'row' },
  inlineRow: { flexDirection: 'row', alignItems: 'flex-start' },
  gpsRow: { flexDirection: 'row', alignItems: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  footerRow: { flexDirection: 'row' },
  cameraRoot: { flex: 1, backgroundColor: '#000' },
  cameraTop: { paddingHorizontal: 16, gap: 12 },
  cameraHint: { backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10, padding: 10 },
  cameraChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraChipPlaceholder: { width: 44, height: 44 },
  cameraBottom: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF' },
});
