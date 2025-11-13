"""
Test version of setup_slots.py for any image/location
Takes location from CLI and creates parking area in database
"""
from ultralytics import YOLO
import cv2
import json
from supabase import create_client, Client
from datetime import datetime
import uuid
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

# Load YOLO model from environment variables
YOLO_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")  # Default fallback
model = YOLO(YOLO_MODEL)

def test_detection_accuracy(image_path='reference.png', location_name="Test Location"):
    """Test parking slot detection and create parking area in database"""
    print("Loading reference image...")
    img = cv2.imread(image_path)
    if img is None:
        print(f"Error: Could not load image '{image_path}'")
        print(f"Make sure {image_path} exists in the project2.0 folder")
        return

    # Create parking area in database first
    area_uuid = str(uuid.uuid4())
    print(f"Creating parking area: {location_name}")
    
    try:
        area_data = {
            "id": area_uuid,
            "name": location_name,
            "lat": 0.0,  # Default coordinates - can be updated later
            "lng": 0.0,
            "total_slots": 0  # Will update after detection
        }
        supabase.table("parking_areas").upsert(area_data, on_conflict="id").execute()
        print(f"✅ Created parking area: {location_name} (UUID: {area_uuid})")
    except Exception as e:
        print(f"❌ Database error creating area: {e}")
        return

    print(f"Running YOLO detection for {location_name}...")
    print("Using confidence threshold (30%) for slot detection")
    # Run YOLO detection
    results = model(img)[0]
    slots = []
    slot_index = 1

    print("\n=== DETECTION RESULTS ===")
    print(f"Image size: {img.shape[1]}x{img.shape[0]}")
    
    detected_vehicles = 0
    if hasattr(results, 'boxes') and results.boxes is not None:
        for det in results.boxes.data.cpu().numpy():
            x1, y1, x2, y2, score, class_id = det
            class_id = int(class_id)
            
            # Get detection configuration from environment
            DETECTION_CONFIDENCE = float(os.getenv("DETECTION_CONFIDENCE_THRESHOLD", "0.3"))
            VEHICLE_CLASSES = list(map(int, os.getenv("VEHICLE_CLASSES", "2,5,7").split(",")))
            
            # Check if it's a vehicle with good confidence
            if class_id in VEHICLE_CLASSES:  # configured vehicle classes
                detected_vehicles += 1
                if score > DETECTION_CONFIDENCE:  # Use configured threshold
                    slot = {
                        'x1': int(x1),
                        'y1': int(y1),
                        'x2': int(x2),
                        'y2': int(y2)
                    }
                    slots.append(slot)

                    # Insert slot into database
                    try:
                        supabase.table("slots").upsert({
                            "parking_area_id": area_uuid,
                            "slot_number": slot_index,
                            "status": "free",
                            "updated_at": datetime.utcnow().isoformat()
                        }, on_conflict="parking_area_id,slot_number").execute()
                    except Exception as e:
                        print(f"❌ Database error for slot {slot_index}: {e}")

                    # Draw detection
                    cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                    cv2.putText(img, f"Slot {slot_index} ({score:.2f})", (int(x1), int(y1)-10),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 2)
                    
                    print(f"Slot {slot_index}: Confidence={score:.2f}, Class={class_id}, BBox=[{int(x1)},{int(y1)},{int(x2)},{int(y2)}]")
                    slot_index += 1

    # Save results for testing
    with open('test_slots.json', 'w') as f:
        json.dump(slots, f, indent=2)

    # Update parking area with correct total_slots count
    if slots:
        try:
            supabase.table("parking_areas").update({
                "total_slots": len(slots)
            }).eq("id", area_uuid).execute()
            print(f"✅ Updated parking area total_slots to {len(slots)}")
        except Exception as e:
            print(f"❌ Error updating total_slots: {e}")

    print(f"\n=== SETUP RESULTS ===")
    print(f"📍 Location: {location_name}")
    print(f"🆔 Area UUID: {area_uuid}")
    print(f"Total vehicles detected: {detected_vehicles}")
    print(f"High confidence slots (>30%): {len(slots)}")
    print(f"Database slots created: {len(slots)}")
    print(f"Detection rate: {len(slots)/detected_vehicles*100:.1f}%" if detected_vehicles > 0 else "N/A")

    # Display result
    cv2.imshow(f'{location_name} - Detection Test - Press any key to close', img)
    print(f"\nShowing detection results for {location_name}. Press any key to close window.")
    cv2.waitKey(0)
    cv2.destroyAllWindows()
    
    print(f"\n🎯 RECOMMENDATION:")
    if len(slots) >= 15:
        print(f"✅ EXCELLENT: {len(slots)} slots detected - Perfect for parking monitoring!")
    elif len(slots) >= 8:
        print(f"✅ GOOD: {len(slots)} slots detected - Suitable for testing")
    else:
        print(f"⚠️  LIMITED: Only {len(slots)} slots detected - Consider different footage")
    
    return len(slots)

if __name__ == "__main__":
    import sys
    
    # Require location name from CLI
    if len(sys.argv) < 2:
        print("❌ Usage: python test_setup.py <location_name> [image_path]")
        print("Example: python test_setup.py 'Shopping Mall Parking' reference.png")
        sys.exit(1)
    
    location_name = sys.argv[1]
    image_path = sys.argv[2] if len(sys.argv) > 2 else 'reference.png'
    
    print(f"🎯 Setting up parking area: {location_name}")
    print(f"📷 Using image: {image_path}")
    print("-" * 50)
    
    slots_detected = test_detection_accuracy(image_path, location_name)
    print(f"\n✅ Setup completed! {slots_detected} parking slots created in database for {location_name}")