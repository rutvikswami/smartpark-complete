"""
Test version of monitor.py for any video/location
Works with database like the main monitor.py
"""
from ultralytics import YOLO
import cv2
import json
import time
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

# Load lightweight YOLO model
model = YOLO('yolov8n.pt')

def box_iou(boxA, boxB):
    """Calculate IoU between two bounding boxes"""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    
    if xB <= xA or yB <= yA:
        return 0.0
        
    interArea = (xB - xA) * (yB - yA)
    boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    unionArea = boxAArea + boxBArea - interArea
    return interArea / unionArea if unionArea > 0 else 0.0

def test_monitoring_accuracy(video_path="parking_lot.mp4", max_frames=50, location_name="Test Location"):
    """Test monitoring accuracy with database integration"""
    
    # Get area_uuid from database
    try:
        # Get parking areas from database
        areas_response = supabase.table('parking_areas').select('*').execute()
        if not areas_response.data:
            print("❌ No parking areas found in database!")
            print("Please run test_setup.py first to create a parking area.")
            return
        
        # Show available areas
        print("\n📍 Available parking areas:")
        for i, area in enumerate(areas_response.data):
            print(f"{i+1}. {area['name']} (ID: {area['id']})")
        
        # Let user choose area or find by name
        selected_area = None
        if location_name != "Test Location":
            # Try to find area by name
            for area in areas_response.data:
                if location_name.lower() in area['name'].lower():
                    selected_area = area
                    break
        
        if not selected_area:
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
        location_name = selected_area['name']
                
    except Exception as e:
        print(f"❌ Database error: {e}")
        return
    
    # Load slots from test_slots.json
    try:
        with open('test_slots.json', 'r') as f:
            slots = json.load(f)
        print(f"✅ Loaded {len(slots)} parking slots")
    except FileNotFoundError:
        print("❌ test_slots.json not found. Run test_setup.py first.")
        return

    # Open video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"❌ Error opening video: {video_path}")
        return

    print(f"✅ Video opened: {video_path}")
    print(f"📍 Testing monitoring accuracy for: {location_name}")
    print("🎯 Using 30% confidence threshold for maximum vehicle detection")
    print("Press 'q' to quit early")

    frame_count = 0
    detection_stats = {"frames_processed": 0, "total_detections": 0, "avg_confidence": 0}
    slot_changes = 0
    last_status = {i: "unknown" for i in range(len(slots))}

    while frame_count < max_frames:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # Loop video
            continue

        frame_count += 1
        
        # Process every 2nd frame (optimization)
        if frame_count % 2 != 0:
            continue

        detection_stats["frames_processed"] += 1
        start_time = time.time()

        # Run detection
        results = model(frame, verbose=False)[0]
        detected_boxes = []
        frame_detections = 0

        # Extract vehicles
        if hasattr(results, 'boxes') and results.boxes is not None:
            for det in results.boxes.data.cpu().numpy():
                x1, y1, x2, y2, score, class_id = det
                if int(class_id) in [2, 5, 7] and score > 0.3:
                    detected_boxes.append([float(x1), float(y1), float(x2), float(y2)])
                    frame_detections += 1

        detection_stats["total_detections"] += frame_detections
        
        # Check slots and collect updates (like main monitor.py)
        updates_needed = []
        for i, slot in enumerate(slots):
            slot_box = [slot['x1'], slot['y1'], slot['x2'], slot['y2']]
            current_status = "occupied" if any(box_iou(slot_box, vbox) > 0.3 for vbox in detected_boxes) else "available"

            # Track status changes and prepare database updates
            if last_status[i] != current_status:
                slot_changes += 1
                db_status = "free" if current_status == "available" else "occupied"
                updates_needed.append({
                    "slot_index": i,
                    "new_status": current_status,
                    "parking_area_id": area_uuid,
                    "slot_number": i + 1,
                    "status": db_status,
                    "updated_at": datetime.datetime.utcnow().isoformat()
                })

            # Draw slots
            color = (0, 0, 255) if last_status[i] == "occupied" else (0, 255, 0)
            cv2.rectangle(frame, (int(slot['x1']), int(slot['y1'])), (int(slot['x2']), int(slot['y2'])), color, 2)
            cv2.putText(frame, f"Slot {i+1}", (int(slot['x1']), int(slot['y1']) - 5), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
        
        # Update database (like main monitor.py)
        if updates_needed:
            try:
                for update in updates_needed:
                    db_update = {k: v for k, v in update.items() if k not in ['slot_index', 'new_status']}
                    supabase.table("slots").upsert(db_update, on_conflict='parking_area_id,slot_number').execute()
                    last_status[update['slot_index']] = update['new_status']
                    print(f"✅ Updated DB: Slot {update['slot_number']} = {update['status']}")
            except Exception as e:
                print(f"❌ Database error: {e}")

        # Draw vehicles
        for box in detected_boxes:
            x1, y1, x2, y2 = [int(coord) for coord in box]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 0), 2)

        # Show stats
        occupied = sum(1 for status in last_status.values() if status == "occupied")
        available = len(slots) - occupied
        processing_time = (time.time() - start_time) * 1000

        cv2.putText(frame, f"Frame {frame_count} | Available: {available} | Occupied: {occupied}", 
                   (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(frame, f"Vehicles: {frame_detections} | Processing: {processing_time:.1f}ms", 
                   (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        cv2.imshow(f'{location_name} - Monitoring Test - Press q to quit', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

    # Final statistics
    frames_processed = detection_stats["frames_processed"]
    avg_detections = detection_stats["total_detections"] / frames_processed if frames_processed > 0 else 0
    
    print(f"\n=== {location_name.upper()} - MONITORING TEST RESULTS ===")
    print(f"📊 Frames processed: {frames_processed}")
    print(f"🚗 Total vehicle detections: {detection_stats['total_detections']}")
    print(f"📈 Average vehicles per frame: {avg_detections:.1f}")
    print(f"🔄 Slot status changes: {slot_changes}")
    print(f"⚡ Change rate: {slot_changes/frames_processed:.2f} changes/frame")
    
    # Current final status
    occupied_final = sum(1 for status in last_status.values() if status == "occupied")
    occupancy_rate = occupied_final/len(slots)*100
    print(f"🎯 Final occupancy: {occupied_final}/{len(slots)} slots occupied ({occupancy_rate:.1f}%)")
    
    # Performance rating
    print(f"\n🏆 PERFORMANCE RATING:")
    if avg_detections >= 5 and slot_changes >= 10:
        print("✅ EXCELLENT - High vehicle activity and slot changes detected!")
    elif avg_detections >= 2 and slot_changes >= 5:
        print("✅ GOOD - Decent activity for monitoring testing")
    else:
        print("⚠️  MODERATE - Limited activity, but still functional for testing")

if __name__ == "__main__":
    import sys
    
    # Command line arguments
    video_path = sys.argv[1] if len(sys.argv) > 1 else "parking_lot.mp4"
    location_name = sys.argv[2] if len(sys.argv) > 2 else "Test Location"
    max_frames = int(sys.argv[3]) if len(sys.argv) > 3 else 50
    
    print(f"🎥 Testing parking monitoring system")
    print(f"📍 Location: {location_name}")
    print(f"🎬 Video: {video_path}")
    print(f"🔢 Max frames: {max_frames}")
    print("-" * 60)
    
    test_monitoring_accuracy(video_path, max_frames, location_name)