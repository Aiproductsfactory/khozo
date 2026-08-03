import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

/**
 * WhatsApp-style full-screen image viewer modal.
 * Displays a full-screen high-res child photo on dark backdrop with close button and title.
 */
export function ImageViewerModal({ visible, imageUri, title, onClose }) {
  const insets = useSafeAreaInsets();

  if (!visible || !imageUri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Top Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close image preview"
            onPress={onClose}
            style={styles.closeBtn}
          >
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </Pressable>
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          <View style={{ width: 40 }} />
        </View>

        {/* Backdrop Tap dismiss */}
        <Pressable style={styles.imageContainer} onPress={onClose}>
          <Image source={{ uri: imageUri }} style={styles.fullImage} resizeMode="contain" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    zIndex: 10,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justify: 'center',
  },
  title: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  imageContainer: {
    flex: 1,
    alignItems: 'center',
    justify: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
});

export default ImageViewerModal;
