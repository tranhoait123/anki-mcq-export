import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics, logEvent, Analytics } from "firebase/analytics";

// Lấy thông tin cấu hình từ biến môi trường
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Kiểm tra xem cấu hình có hợp lệ và không phải là placeholder mặc định
const isConfigValid =
  firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== "your_api_key_here" &&
  firebaseConfig.measurementId &&
  firebaseConfig.measurementId !== "your_measurement_id_here";

let app;
let analytics: Analytics | null = null;

if (isConfigValid && typeof window !== "undefined") {
  try {
    // Khởi tạo Firebase App nếu chưa được khởi tạo
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    // Khởi tạo Analytics
    analytics = getAnalytics(app);
    console.log("🔥 [Firebase] Analytics đã được khởi tạo thành công.");
  } catch (error) {
    console.error("❌ [Firebase] Lỗi khi khởi tạo Firebase Analytics:", error);
  }
} else {
  if (typeof window !== "undefined") {
    console.warn(
      "⚠️ [Firebase] Analytics chưa được kích hoạt. Vui lòng cập nhật các khóa cấu hình thực tế trong tệp .env."
    );
  }
}

/**
 * Ghi lại sự kiện tùy chỉnh (Custom Event) an toàn sang Google Analytics
 * @param eventName Tên của sự kiện (ví dụ: 'file_uploaded')
 * @param eventParams Các thuộc tính/tham số đi kèm sự kiện (ví dụ: { file_count: 2 })
 */
export function logCustomEvent(eventName: string, eventParams?: Record<string, any>) {
  if (analytics) {
    try {
      logEvent(analytics, eventName, eventParams);
      // Log ra console ở chế độ development để tiện theo dõi
      if (import.meta.env.DEV) {
        console.log(`📊 [Analytics Log] Event: ${eventName}`, eventParams);
      }
    } catch (error) {
      console.error(`❌ [Analytics Error] Lỗi ghi nhận sự kiện ${eventName}:`, error);
    }
  } else if (import.meta.env.DEV) {
    console.log(`📊 [Analytics Mocked] Event: ${eventName} (Chưa cấu hình .env)`, eventParams);
  }
}

export { app, analytics };
