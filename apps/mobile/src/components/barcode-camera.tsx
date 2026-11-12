import { CameraView, useCameraPermissions } from "expo-camera";
import { StyleSheet, Text } from "react-native";
import { usePalette } from "@/theme";
import { Button } from "./ui";

const BARCODE_TYPES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

// Caméra qui lit les codes-barres de produits en continu. Sans permission, elle explique à
// quoi elle sert et propose de l'accorder ; la saisie du code à la main reste possible.
export function BarcodeCamera(props: { onCode: (code: string) => void; paused?: boolean }) {
  const palette = usePalette();
  const [permission, requestPermission] = useCameraPermissions();

  if (permission?.granted) {
    return (
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        facing="back"
        onBarcodeScanned={props.paused ? undefined : ({ data }) => props.onCode(data)}
        style={styles.camera}
      />
    );
  }
  return (
    <>
      <Text style={{ color: palette.textSecondary, lineHeight: 22 }}>
        L'appareil photo lit les codes-barres en continu : passe les produits devant l'objectif.
      </Text>
      <Button label="Autoriser l'appareil photo" onPress={requestPermission} variant="secondary" />
    </>
  );
}

const styles = StyleSheet.create({
  camera: { height: 220, borderRadius: 12, overflow: "hidden" },
});
