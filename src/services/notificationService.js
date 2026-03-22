import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// 1. Configure how notifications appear when the app is OPEN
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// 2. Request Permissions
export async function registerForPushNotificationsAsync() {
  // Set up Android Channel (Required for Android 8+)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  // Check Permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.log('Notification permissions not granted!');
    return false;
  }
  return true;
}

// 3. Send Immediate Confirmation
export async function sendAppointmentConfirmation(patientName, date, time) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "✅ Appointment Confirmed!",
      body: `Hi ${patientName}, your appointment is set for ${date} at ${time}.`,
      sound: true,
    },
    trigger: null, // null means "send immediately"
  });
}

// 4. Schedule Future Reminder (24 hours before)
export async function scheduleAppointmentReminder(patientName, appointmentDateString) {
  // appointmentDateString format example: "2025-10-24T14:30:00"
  const appointmentDate = new Date(appointmentDateString);
  
  // Calculate 1 day before
  const reminderDate = new Date(appointmentDate);
  reminderDate.setDate(appointmentDate.getDate() - 1); // Subtract 1 day

  const now = new Date();

  // Only schedule if the reminder time is in the future
  if (reminderDate > now) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "⏰ Appointment Reminder",
        body: `Hi ${patientName}, you have an appointment tomorrow at ${appointmentDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}.`,
        sound: true,
      },
      trigger: {
        date: reminderDate, // Fires at this exact date/time
      },
    });
    console.log("Reminder scheduled for:", reminderDate);
  } else {
    console.log("Reminder time has already passed, skipping.");
  }
}