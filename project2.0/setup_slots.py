
from ultralytics import YOLO
import cv2
import json
from supabase import create_client, Client
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Supabase config from environment
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")

if not url or not key:
    raise Exception("Missing SUPABASE_URL or SUPABASE_KEY environment variables")

supabase: Client = create_client(url, key)

# Auth from environment
USER_EMAIL = os.getenv("USER_EMAIL")
USER_PASSWORD = os.getenv("USER_PASSWORD")

if not USER_EMAIL or not USER_PASSWORD:
    raise Exception("Missing USER_EMAIL or USER_PASSWORD environment variables")
auth_response = supabase.auth.sign_in_with_password({
    "email": USER_EMAIL,
    "password": USER_PASSWORD
})
if not auth_response.user:
    raise Exception("Failed to authenticate")
supabase.auth.session = auth_response.session

# Load YOLO model from environment variables
YOLO_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")  # Default fallback
yolo_model = YOLO(YOLO_MODEL)

def detect_parking_slots(image_path, save_json='slots.json'):
    """Detect parking slots using lightweight YOLO only"""
    img = cv2.imread(image_path)
    if img is None:
        print("Error loading image")
        return

    # Get area_uuid from database
    try:
        # Get parking areas from database
        areas_response = supabase.table('parking_areas').select('*').execute()
        if not areas_response.data:
            print("❌ No parking areas found in database!")
            print("Please create a parking area first in the database.")
            return
        
        # Show available areas
        print("\n📍 Available parking areas:")
        for i, area in enumerate(areas_response.data):
            print(f"{i+1}. {area['name']} (ID: {area['id']})")
        
        # Let user choose area
        while True:
            try:
                choice = input(f"\nSelect parking area (1-{len(areas_response.data)}): ")
                area_index = int(choice) - 1
                if 0 <= area_index < len(areas_response.data):
                    selected_area = areas_response.data[area_index]
                    break
                else:
                    print("❌ Invalid choice. Please try again.")
            except ValueError:
                print("❌ Please enter a valid number.")
        
        # Authenticate with location password
        location_password = input(f"\nEnter password for {selected_area['name']}: ")
        if location_password != selected_area['password']:
            print("❌ Incorrect password! Access denied.")
            return
        
        print(f"✅ Access granted to {selected_area['name']}")
        area_uuid = selected_area['id']
                
    except Exception as e:
        print(f"❌ Database error: {e}")
        return

    # Run YOLO detection (no Mask R-CNN needed)
    results = yolo_model(img)[0]
    slots = []
    slot_index = 1

    for det in results.boxes.data.cpu().numpy():
        x1, y1, x2, y2, score, class_id = det
        class_id = int(class_id)

        # Get detection configuration from environment
        DETECTION_CONFIDENCE = float(os.getenv("DETECTION_CONFIDENCE_THRESHOLD", "0.3"))
        VEHICLE_CLASSES = list(map(int, os.getenv("VEHICLE_CLASSES", "2,5,7").split(",")))
        
        # Only detect vehicles from configured classes with configured confidence
        if class_id in VEHICLE_CLASSES and score > DETECTION_CONFIDENCE:
            slot = {
                'x1': int(x1),
                'y1': int(y1),
                'x2': int(x2),
                'y2': int(y2),
                'slot': slot_index,
                'score': float(score)
            }
            slots.append(slot)

            
            # Insert slot into correct table
            supabase.table("slots").upsert({
                "parking_area_id": area_uuid,
                "slot_number": slot_index,
                "status": "free",  # Using correct status values
                "updated_at": datetime.utcnow().isoformat()
            }, on_conflict="parking_area_id,slot_number").execute()

            # Draw detection
            cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
            cv2.putText(img, f"Slot {slot_index}", (int(x1), int(y1)-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 2)
            slot_index += 1

    # Save slots
    with open(save_json, 'w') as f:
        json.dump(slots, f, indent=2)

    # Update parking area with correct total_slots count
    if slots:
        supabase.table("parking_areas").update({
            "total_slots": len(slots)
        }).eq("id", area_uuid).execute()
        print(f"✅ Updated parking area total_slots to {len(slots)}")

    print(f"Detected {len(slots)} parking slots")
    cv2.imshow('Detected Slots', img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

if __name__ == "__main__":
    detect_parking_slots('reference.png')