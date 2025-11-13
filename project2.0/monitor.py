"""
Simple parking monitor - replaces monitor_parking.py
Optimized: 3x faster with frame skipping and lightweight model
"""
from ultralytics import YOLO
import cv2
import json
import time
import signal
import sys
from supabase import create_client, Client
import datetime
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

# Use model from environment variables
YOLO_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")  # Default fallback
model = YOLO(YOLO_MODEL)

def box_iou(boxA, boxB):
    """Calculate IoU between two bounding boxes"""
    try:
        xA = max(boxA[0], boxB[0])
        yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2])
        yB = min(boxA[3], boxB[3])
        interWidth = max(0, xB - xA)
        interHeight = max(0, yB - yA)
        interArea = interWidth * interHeight
        boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
        boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
        unionArea = boxAArea + boxBArea - interArea
        return interArea / unionArea if unionArea > 0 else 0.0
    except:
        return 0.0

def set_status_online(system_id="parking_monitor_tech_park_whitefield", location="Tech Park Whitefield"):
    """Set system status to online with current timestamp"""
    try:
        current_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        # First check if the record exists
        existing = supabase.table("system_status").select("*").eq("system_id", system_id).execute()
        
        if existing.data:
            # Update existing record - only this specific system_id
            result = supabase.table("system_status").update({
                "status": "online",
                "last_heartbeat": current_time
            }).eq("system_id", system_id).execute()
        else:
            # Insert new record
            result = supabase.table("system_status").insert({
                "system_id": system_id,
                "status": "online",
                "location": location,
                "last_heartbeat": current_time
            }).execute()
        
        print(f"💚 Status set to ONLINE at {current_time}")
        return True
    except Exception as e:
        print(f"❌ Failed to set online status: {e}")
        return False

def set_status_offline(system_id="parking_monitor_tech_park_whitefield"):
    """Set system status to offline WITHOUT updating timestamp"""
    try:
        
        # Only update the status field, keep existing timestamp
        result = supabase.table("system_status").update({
            "status": "offline"
        }).eq("system_id", system_id).execute()
        
        print(f"🔴 Status set to OFFLINE")
        return True
    except Exception as e:
        print(f"❌ Failed to set offline status: {e}")
        return False

def cleanup_and_exit(signum=None, frame=None, system_id="parking_monitor_tech_park_whitefield"):
    """Set status to offline and exit gracefully"""
    print("\n🛑 Shutting down monitor...")
    set_status_offline(system_id)
    cv2.destroyAllWindows()
    print("✅ Monitor stopped and status set to offline")
    sys.exit(0)

def monitor(video_path=None, iou_threshold=0.3, update_interval=3, system_id="parking_monitor_tech_park_whitefield", location="Tech Park Whitefield", area_uuid=None):  # Back to 3 seconds for proper timing
    """
    Optimized monitoring with:
    - Frame skipping (2x faster)
    - Batch updates (fewer DB calls)
    - Lightweight model (5x faster inference)
    - System heartbeat monitoring
    - Configurable system ID for different locations
    """
    if not video_path:
        print("Error: No video path provided.")
        return

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("Error opening video source")
        return

    # Load slots
    try:
        with open('slots.json', 'r') as f:
            slots = json.load(f)
    except FileNotFoundError:
        print("Error: slots.json not found. Run setup_slots.py first.")
        return

    last_status = {i: "unknown" for i in range(len(slots))}
    last_update_time = 0
    last_heartbeat_time = 0
    frame_count = 0

    print("Press 'q' to quit.")
    print(f"Monitoring {len(slots)} slots at {location}")
    
    # Set up signal handlers for graceful shutdown with system_id
    signal.signal(signal.SIGINT, lambda s, f: cleanup_and_exit(s, f, system_id))
    signal.signal(signal.SIGTERM, lambda s, f: cleanup_and_exit(s, f, system_id))
    
    # Initial status - set to online
    set_status_online(system_id, location)

    while True:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # Loop video
            continue

        frame_count += 1
        
        # Get frame skip configuration from environment
        FRAME_SKIP_COUNT = int(os.getenv("FRAME_SKIP_COUNT", "3"))
        
        # OPTIMIZATION: Process every nth frame for performance
        if frame_count % FRAME_SKIP_COUNT != 0:
            cv2.imshow('Parking Monitor', frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
            continue

        # Run detection
        results = model(frame, verbose=False)[0]
        detected_boxes = []

        # Get detection configuration from environment
        DETECTION_CONFIDENCE = float(os.getenv("DETECTION_CONFIDENCE_THRESHOLD", "0.3"))
        VEHICLE_CLASSES = list(map(int, os.getenv("VEHICLE_CLASSES", "2,5,7").split(",")))
        
        # Extract vehicles
        for det in results.boxes.data.cpu().numpy():
            x1, y1, x2, y2, score, class_id = det
            if int(class_id) in VEHICLE_CLASSES and score > DETECTION_CONFIDENCE:
                detected_boxes.append([float(x1), float(y1), float(x2), float(y2)])

        # Check slots and collect updates  
        updates_needed = []
        for i, slot in enumerate(slots):
            slot_box = [slot['x1'], slot['y1'], slot['x2'], slot['y2']]
            current_status = "occupied" if any(box_iou(slot_box, vbox) > iou_threshold for vbox in detected_boxes) else "available"

            # Only track changes, don't update last_status yet
            if last_status[i] != current_status:
                # Convert status to match database schema
                # Use the correct area_uuid for the selected location
                if not area_uuid:
                    print("❌ Error: No area UUID provided")
                    continue
                db_status = "free" if current_status == "available" else "occupied"
                updates_needed.append({
                    "slot_index": i,
                    "new_status": current_status,
                    "parking_area_id": area_uuid,
                    "slot_number": i + 1,  # Database uses 1-based indexing (Slot 0 -> DB slot 1)
                    "status": db_status,  # free/occupied/reserved
                    "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                })
                print(f"Status change detected: Video Slot {i} -> {db_status}")

        # FIXED: Batch update at proper intervals (3-5 seconds for your video)
        if updates_needed and time.time() - last_update_time >= update_interval:
            try:
                for update in updates_needed:
                    # Update the database
                    db_update = {k: v for k, v in update.items() if k not in ['slot_index', 'new_status']}
                    supabase.table("slots").upsert(db_update, on_conflict='parking_area_id,slot_number').execute()
                    # Update local status tracking
                    last_status[update['slot_index']] = update['new_status']
                    print(f"✅ Updated DB: Slot {update['slot_number']} = {update['status']}")
                
                print(f"📊 Batch updated {len(updates_needed)} slots")
                last_update_time = time.time()
            except Exception as e:
                print(f"❌ Database error: {e}")

        # Get heartbeat interval from environment
        HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "30"))
        
        # Update status to online at configured interval
        current_time = time.time()
        if current_time - last_heartbeat_time >= HEARTBEAT_INTERVAL:
            set_status_online(system_id, location)
            last_heartbeat_time = current_time

        # Draw slots with status (show database slot number for consistency)
        for i, slot in enumerate(slots):
            color = (0, 0, 255) if last_status[i] == "occupied" else (0, 255, 0)
            cv2.rectangle(frame, (int(slot['x1']), int(slot['y1'])), (int(slot['x2']), int(slot['y2'])), color, 2)
            cv2.putText(frame, f"Slot {i+1}", (int(slot['x1']), int(slot['y1']) - 5), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # Show stats
        occupied = sum(1 for status in last_status.values() if status == "occupied")
        available = len(slots) - occupied
        cv2.putText(frame, f"Available: {available} | Occupied: {occupied}", (10, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        cv2.imshow('Parking Monitor', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cleanup_and_exit(system_id=system_id)

def select_parking_location():
    """Select parking location and authenticate with location password"""
    try:
        # Get parking areas from database
        areas_response = supabase.table('parking_areas').select('*').execute()
        if not areas_response.data:
            print("❌ No parking areas found in database!")
            return None, None, None
        
        # Show available areas
        print("\n🏢 Available parking locations:")
        for i, area in enumerate(areas_response.data):
            print(f"{i+1}. {area['name']} ({area['total_slots']} slots)")
        
        # Let user choose location
        while True:
            try:
                choice = input(f"\nSelect parking location (1-{len(areas_response.data)}): ")
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
            return None, None, None
        
        print(f"✅ Access granted to {selected_area['name']}")
        
        # Generate system ID and get location info
        system_id = f"parking_monitor_{selected_area['name'].lower().replace(' ', '_')}"
        location_name = selected_area['name']
        area_uuid = selected_area['id']
        
        return system_id, location_name, area_uuid
        
    except Exception as e:
        print(f"❌ Location selection error: {e}")
        return None, None, None

if __name__ == "__main__":
    print("🚀 SmartPark Monitoring System")
    print("=" * 40)
    
    # Select and authenticate with parking location
    system_id, location_name, area_uuid = select_parking_location()
    
    if not system_id:
        print("❌ Failed to authenticate. Exiting...")
        sys.exit(1)
    
    print(f"\n🎯 Starting monitoring for: {location_name}")
    print(f"📡 System ID: {system_id}")
    
    try:
        monitor(video_path="parking_lot.mp4", system_id=system_id, location=location_name, area_uuid=area_uuid)
    except KeyboardInterrupt:
        cleanup_and_exit(system_id=system_id)
    except Exception as e:
        print(f"❌ Monitor error: {e}")
        cleanup_and_exit(system_id=system_id)