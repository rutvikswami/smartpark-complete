import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MapPin, Car, ExternalLink, Navigation } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Database } from '@/lib/supabase.ts'

type ParkingArea = Database['public']['Tables']['parking_areas']['Row']
type Slot = Database['public']['Tables']['slots']['Row']

interface ParkingAreaWithOccupancy extends ParkingArea {
  freeSlots: number
  occupiedSlots: number
  reservedSlots: number
  occupancyPercentage: number
}

interface MapComponentProps {
  parkingAreas: ParkingAreaWithOccupancy[]
  onAreaSelect: (areaId: string, areaData?: ParkingAreaWithOccupancy) => void
}

interface MapProps {
  center: { lat: number; lng: number }
  zoom: number
  parkingAreas: ParkingAreaWithOccupancy[]
  onAreaSelect: (areaId: string, areaData?: ParkingAreaWithOccupancy) => void
}

function MapTilerMap({ center, zoom, parkingAreas, onAreaSelect }: MapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<any>(null)
  const [markersLayer, setMarkersLayer] = useState<any>(null)

  useEffect(() => {
    if (!map && mapRef.current) {
      const L = (window as any).L
      if (!L) {
        return
      }
      
      // Check if map container is already initialized
      if (mapRef.current._leaflet_id) {
        mapRef.current._leaflet_id = null
      }
      
      // Create map
      const newMap = L.map(mapRef.current).setView([center.lat, center.lng], zoom)
      
      // Add MapTiler tile layer
      L.tileLayer(`https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=bUtgcZnxNjR0qtG7QluP`, {
        attribution: '© MapTiler © OpenStreetMap contributors',
        maxZoom: 18
      }).addTo(newMap)
      
      setMap(newMap)
    }
    
    // Cleanup function
    return () => {
      if (map) {
        map.remove()
        setMap(null)
      }
    }
  }, [center, zoom])

  useEffect(() => {
    if (map && parkingAreas.length > 0) {
      const L = (window as any).L
      if (!L) return

      // Clear existing markers
      if (markersLayer) {
        try {
          map.removeLayer(markersLayer)
        } catch (error) {
          // Error removing markers layer
        }
      }

      const newMarkersLayer = L.layerGroup().addTo(map)
      
      parkingAreas.forEach((area) => {
        // Validate area data
        if (!area || !area.lat || !area.lng || !area.name || area.freeSlots == null) {
          // Invalid area data
          return
        }
        // Determine marker color based on occupancy
        const occupancyColor = area.occupancyPercentage > 80 ? '#EF4444' : 
                              area.occupancyPercentage > 50 ? '#F59E0B' : '#10B981'
        
        // Create custom marker icon
        const customIcon = L.divIcon({
          className: 'custom-div-icon',
          html: `
            <div style="
              width: 32px; 
              height: 32px; 
              background-color: ${occupancyColor}; 
              border: 2px solid white; 
              border-radius: 50%; 
              display: flex; 
              align-items: center; 
              justify-content: center; 
              color: white; 
              font-weight: bold; 
              font-size: 10px;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
              cursor: pointer;
            ">
              ${area.freeSlots}
            </div>
            <div style="
              position: absolute;
              top: -25px;
              left: 50%;
              transform: translateX(-50%);
              background-color: ${occupancyColor};
              color: white;
              padding: 2px 6px;
              border-radius: 8px;
              font-size: 9px;
              font-weight: bold;
              white-space: nowrap;
              border: 1px solid white;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            ">
              ${area.name}
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        })

        const marker = L.marker([area.lat, area.lng], { icon: customIcon })
          .addTo(newMarkersLayer)

        const googleMapsUrl = `https://www.google.pt/maps/search/${encodeURIComponent(area.name)}/@${area.lat},${area.lng},17z`

        const popupContent = `
          <div class="p-4 min-w-[280px] bg-gradient-to-br from-white to-gray-50 rounded-lg">
            <h3 class="font-bold text-xl mb-3 cursor-pointer text-blue-600 hover:text-blue-800 flex items-center" 
                onclick="window.selectParkingArea('${area.id}')" 
                title="Click to go to dashboard">
              <span class="mr-2">📍</span>
              ${area.name}
            </h3>
            <div class="grid grid-cols-2 gap-3 mb-4">
              <div class="bg-blue-50 p-2 rounded-lg text-center">
                <div class="text-2xl font-bold text-blue-600">${area.total_slots}</div>
                <div class="text-xs text-blue-500 font-medium">Total Slots</div>
              </div>
              <div class="bg-green-50 p-2 rounded-lg text-center">
                <div class="text-2xl font-bold text-green-600">${area.freeSlots}</div>
                <div class="text-xs text-green-500 font-medium">Available</div>
              </div>
              <div class="bg-red-50 p-2 rounded-lg text-center">
                <div class="text-2xl font-bold text-red-600">${area.occupiedSlots}</div>
                <div class="text-xs text-red-500 font-medium">Occupied</div>
              </div>
              <div class="bg-yellow-50 p-2 rounded-lg text-center">
                <div class="text-2xl font-bold text-yellow-600">${area.reservedSlots}</div>
                <div class="text-xs text-yellow-500 font-medium">Reserved</div>
              </div>
            </div>
            <div class="mb-4 p-2 bg-gray-50 rounded-lg">
              <div class="flex justify-between items-center">
                <span class="text-sm font-medium">Occupancy Rate:</span>
                <span class="font-bold text-lg" style="color: ${occupancyColor}">${area.occupancyPercentage.toFixed(1)}%</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div class="h-2 rounded-full transition-all duration-300" 
                     style="width: ${area.occupancyPercentage}%; background-color: ${occupancyColor}"></div>
              </div>
            </div>
            <div class="flex space-x-2">
              <button 
                onclick="window.selectParkingArea('${area.id}')" 
                class="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 text-sm font-medium transition-all duration-200 flex items-center justify-center"
              >
                <span class="mr-1">📊</span> Dashboard
              </button>
              <button 
                onclick="window.openInGoogleMaps('${area.id}')" 
                class="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 text-sm font-medium transition-all duration-200"
                title="Open in Google Maps"
              >
                📍
              </button>
            </div>
          </div>
        `

        // Double-tap functionality for dashboard navigation
        let clickTimeout: any = null
        let clickCount = 0

        const handleMarkerClick = (e: any) => {
          clickCount++
          
          if (clickCount === 1) {
            clickTimeout = setTimeout(() => {
              // Single click - show popup
              if (marker && map.hasLayer(marker)) {
                marker.openPopup()
              }
              clickCount = 0
            }, 300)
          } else if (clickCount === 2) {
            // Double click - navigate to dashboard
            if (clickTimeout) {
              clearTimeout(clickTimeout)
              clickTimeout = null
            }
            onAreaSelect(area.id, area)
            clickCount = 0
          }
        }

        marker.on('click', handleMarkerClick)
        
        // Store cleanup function for this marker
        marker._clickCleanup = () => {
          if (clickTimeout) {
            clearTimeout(clickTimeout)
            clickTimeout = null
          }
          marker.off('click', handleMarkerClick)
        }
        
        marker.bindPopup(popupContent)
      })

      setMarkersLayer(newMarkersLayer)

      // Global functions for popup buttons
      ;(window as any).selectParkingArea = (areaId: string) => {
        try {
          const selectedArea = parkingAreas.find(area => area.id === areaId)
          if (selectedArea) {
            onAreaSelect(areaId, selectedArea)
          }
        } catch (error) {
          // Error selecting parking area
        }
      }

      ;(window as any).openInGoogleMaps = (areaId: string) => {
        try {
          const selectedArea = parkingAreas.find(area => area.id === areaId)
          if (selectedArea) {
            const url = `https://www.google.pt/maps/search/${encodeURIComponent(selectedArea.name)}/@${selectedArea.lat},${selectedArea.lng},17z`
            window.open(url, '_blank')
          }
        } catch (error) {
          // Error opening Google Maps
        }
      }
    }

    // Cleanup function for markers
    return () => {
      if (markersLayer && markersLayer.eachLayer) {
        markersLayer.eachLayer((layer: any) => {
          if (layer._clickCleanup) {
            layer._clickCleanup()
          }
        })
      }
    }
  }, [map, parkingAreas, onAreaSelect])

  return <div ref={mapRef} style={{ height: '100%', width: '100%', zIndex: 1 }} key={`map-${center.lat}-${center.lng}`} />
}

export function GoogleMapComponent({ parkingAreas, onAreaSelect }: MapComponentProps) {
  const navigate = useNavigate()
  const [selectedArea, setSelectedArea] = useState<ParkingAreaWithOccupancy | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Calculate center based on parking areas or default to Marathahalli
  const center = parkingAreas.length > 0 
    ? { 
        lat: parkingAreas.reduce((sum, area) => sum + area.lat, 0) / parkingAreas.length,
        lng: parkingAreas.reduce((sum, area) => sum + area.lng, 0) / parkingAreas.length
      }
    : { lat: 12.9600, lng: 77.7280 } // Marathahalli center coordinates (between all locations)
  
  const zoom = 14

  const handleAreaSelect = (areaId: string, areaData?: ParkingAreaWithOccupancy) => {
    if (areaData) {
      setSelectedArea(areaData)
    }
    onAreaSelect(areaId, areaData)
    // Navigate to dashboard with selected area
    navigate(`/dashboard?area=${areaId}`)
  }

  const openInGoogleMaps = (area: ParkingAreaWithOccupancy) => {
    const url = `https://www.google.pt/maps/search/${encodeURIComponent(area.name)}/@${area.lat},${area.lng},17z`
    window.open(url, '_blank')
  }

  // Load Leaflet CSS and JS
  useEffect(() => {
    if (!(window as any).L) {
      // Add Leaflet CSS
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.id = 'leaflet-css'
      if (!document.getElementById('leaflet-css')) {
        document.head.appendChild(link)
      }

      // Add Leaflet JS
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.id = 'leaflet-js'
      script.onload = () => setLoading(false)
      script.onerror = () => {
        // Failed to load Leaflet
        setLoading(false)
      }
      
      if (!document.getElementById('leaflet-js')) {
        document.head.appendChild(script)
      }
    } else {
      setLoading(false)
    }

    // Cleanup function
    return () => {
      // Clean up global functions when component unmounts
      if ((window as any).selectParkingArea) {
        delete (window as any).selectParkingArea
      }
      if ((window as any).openInGoogleMaps) {
        delete (window as any).openInGoogleMaps
      }
    }
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="h-[600px]">
          <CardContent className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading MapTiler map...</p>
              <p className="text-xs text-gray-500 mt-2">Please wait while we initialize the map</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="h-[600px]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MapPin className="h-5 w-5" />
              <span>Parking Areas Map (MapTiler)</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <div className="flex items-center space-x-1">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span>Available</span>
              </div>
              <div className="flex items-center space-x-1">
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <span>Busy</span>
              </div>
              <div className="flex items-center space-x-1">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span>Full</span>
              </div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[520px]">
          <MapTilerMap
            center={center}
            zoom={zoom}
            parkingAreas={parkingAreas}
            onAreaSelect={handleAreaSelect}
          />
        </CardContent>
      </Card>

      {/* Selected Area Quick Info */}
      {selectedArea && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{selectedArea.name}</span>
              <div className="flex space-x-2">
                <Button
                  size="sm"
                  onClick={() => navigate(`/dashboard?area=${selectedArea.id}`)}
                  className="flex items-center space-x-1"
                >
                  <Navigation className="h-4 w-4" />
                  <span>View Dashboard</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openInGoogleMaps(selectedArea)}
                  className="flex items-center space-x-1"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span>Google Maps</span>
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{selectedArea.total_slots}</div>
                <div className="text-sm text-gray-600">Total Slots</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{selectedArea.freeSlots}</div>
                <div className="text-sm text-gray-600">Free</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{selectedArea.occupiedSlots}</div>
                <div className="text-sm text-gray-600">Occupied</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{selectedArea.reservedSlots}</div>
                <div className="text-sm text-gray-600">Reserved</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}