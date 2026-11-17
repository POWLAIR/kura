import { Alert, Platform } from "react-native";

// Confirmation avant une action qui ne se rattrape pas.
export function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Annuler", style: "cancel", onPress: () => resolve(false) },
        { text: action, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
