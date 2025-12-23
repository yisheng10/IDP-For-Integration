🏥 React Clinical Patient & CRC Portal
A role-based medical application built with React and Firebase. This system provides two distinct dashboards: one for Patients to log health data and manage appointments, and one for Clinical Research Coordinators (CRC) to monitor patients and schedule visits.

✨ Key Features
🔐 Authentication & Security
Role-Based Access Control:

Patients: Can log in with any email.

CRC (Staff): Must use an email ending in @hospital.com.

Security Guard: Automatic redirection and error handling if a user attempts to log into the wrong portal.

Profile Management: Users can update their Nickname and Bio via a modal.

🩺 Patient Dashboard
Vitals Logging: Log Temperature (°C), SpO₂, and Blood Pressure (Systolic/Diastolic).

History View: View a chronological table of all past vital readings.

Appointment Management:

View upcoming appointments.

Confirm pending appointments.

Request Reschedule for existing appointments (alerts the CRC).

👨‍⚕️ CRC (Staff) Dashboard
Patient List: View all registered patients.

Patient Details: Click a patient to view their specific Vitals History and Appointment Log.

Scheduler:

Schedule new appointments using a calendar picker.

View appointment statuses (Pending, Confirmed, Reschedule Requested).

Emergency Override: Ability to unilaterally change an appointment date (even if confirmed) in case of emergencies.

🛠️ Technology Stack
Frontend: React.js (Vite)

Backend: Firebase Firestore (NoSQL Database)

Auth: Firebase Authentication (Email/Password + Google)

Styling: CSS Modules & Inline React Styles

🚀 Installation & Setup
1. Clone & Install
Bash

git clone <your-repo-url>
cd my-clinical-app
npm install
2. Configure Firebase
Go to the Firebase Console.

Create a project and enable Authentication (Email/Password and Google providers).

Create a Firestore Database.

Copy your firebase configuration keys.

Open src/firebase.jsx and paste your keys:

JavaScript

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  // ... other keys
};
3. Run the App
Bash

npm run dev
⚙️ Configuration
You can customize the look and feel directly in src/App.jsx using the constants at the top of the file:

JavaScript

// Change the App Name (displayed in Tab & Navbar)
const APP_NAME = "My Clinical App"; 

// Change the Favicon (Browser Tab Icon)
const APP_ICON = "https://link-to-your-icon.png"; 

// Change Background (URL or local path like "/bg.jpg")
const APP_BACKGROUND_IMAGE = ""; 
📖 Usage Guide
Logging In
To test Patient view: Sign up with any personal email (e.g., john@gmail.com).

To test CRC view: Sign up with a hospital email (e.g., admin@hospital.com).

Appointment Workflow
CRC schedules a date for Patient. Status: Pending (Orange).

Patient logs in, sees date, clicks "Confirm". Status: Confirmed (Green).

Patient realizes they can't make it, clicks "Request Reschedule". Status: Reschedule Requested (Red).

CRC sees the red flag, picks a new date using the calendar. Status resets to Pending.

Patient confirms the new date.

🤖 Future AI Integration (Roadmap)
The architecture is designed to support an external AI Auto-Scheduler.

Logic: An AI model (Python/Flask) can listen to the database.

Integration: The AI will write predicted dates to a field ai_suggestion.

CRC Interface: The CRC will see a "Suggested by AI" box and can approve or override the suggestion manually.

📂 Project Structure
/src
  ├── App.jsx        # Main Logic (Dashboards, Routing, Security)
  ├── firebase.jsx   # Firebase Connection
  ├── index.css      # Global Styles (Background, Centering)
  └── main.jsx       # React Entry Point
/public
  └── (Place local images here)
