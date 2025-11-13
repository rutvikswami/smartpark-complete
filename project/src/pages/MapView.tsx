import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GoogleMapComponent } from '@/components/map/GoogleMapComponent'
import { supabase } from '@/lib/supabase.ts'
import toast from 'react-hot-toast'
import type { Database } from '@/lib/supabase.ts'

type ParkingArea = Database['public']['Tables']['parking_areas']['Row']
type Slot = Database['public']['Tables']['slots']['Row']

interface ParkingAreaWithOccupancy extends ParkingArea {
  freeSlots: number
  occupiedSlots: number
  reservedSlots: number
  occupancyPercentage: number
}

export function MapView() {
  const [parkingAreasWithOccupancy, setParkingAreasWithOccupancy] = useState<ParkingAreaWithOccupancy[]>([])
  const [selectedArea, setSelectedArea] = useState<ParkingAreaWithOccupancy | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchParkingAreasWithOccupancy = async () => {
      try {
        setLoading(true)
        // Fetch parking areas
        const { data: areas, error: areasError } = await supabase
          .from('parking_areas')
          .select('*')

        if (areasError) {
          throw areasError
        }

        if (!areas) {
          setParkingAreasWithOccupancy([])
          return
        }

        // Fetch slots for each area and calculate occupancy
        const areasWithOccupancy = await Promise.all(
          areas.map(async (area) => {
            const { data: slots, error: slotsError } = await supabase
              .from('slots')
              .select('*')
              .eq('parking_area_id', area.id)

            if (slotsError) {
              // Error fetching slots for area
              return {
                ...area,
                freeSlots: 0,
                occupiedSlots: 0,
                reservedSlots: 0,
                occupancyPercentage: 0
              }
            }

            const freeSlots = slots?.filter(s => s.status === 'free').length || 0
            const occupiedSlots = slots?.filter(s => s.status === 'occupied').length || 0
            const reservedSlots = slots?.filter(s => s.status === 'reserved').length || 0
            const totalSlots = area.total_slots || 0
            const occupancyPercentage = totalSlots > 0 ? ((occupiedSlots + reservedSlots) / totalSlots) * 100 : 0

            return {
              ...area,
              freeSlots,
              occupiedSlots,
              reservedSlots,
              occupancyPercentage
            }
          })
        )

        setParkingAreasWithOccupancy(areasWithOccupancy)
      } catch (error) {
        // Error fetching parking areas
        toast.error('Failed to load parking areas')
      } finally {
        setLoading(false)
      }
    }

    fetchParkingAreasWithOccupancy()

    // Set up real-time subscriptions for slot updates
    const slotsChannel = supabase
      .channel('slots-changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'slots' },
        (payload) => {
          // Slots updated
          fetchParkingAreasWithOccupancy()
        }
      )
      .subscribe()

    // Also listen for parking area changes
    const areasChannel = supabase
      .channel('areas-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'parking_areas' },
        (payload) => {
          // Parking areas updated
          fetchParkingAreasWithOccupancy()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(slotsChannel)
      supabase.removeChannel(areasChannel)
    }
  }, [])

  const handleAreaSelect = (areaId: string, areaData?: ParkingAreaWithOccupancy) => {
    const selectedAreaData = areaData || parkingAreasWithOccupancy.find(a => a.id === areaId)
    
    if (selectedAreaData) {
      setSelectedArea(selectedAreaData)
      // Selected area
      
      // Navigate to dashboard with selected area
      const searchParams = new URLSearchParams()
      searchParams.set('area', areaId)
      window.location.href = `/dashboard?${searchParams.toString()}`
    } else {
      // Area not found
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Parking Map</h1>
        <div className="flex items-center justify-center h-96 bg-gray-100 rounded-lg">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading parking areas...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-center"
      >
        <h1 className="text-3xl font-bold">Parking Map</h1>
        {selectedArea && (
          <Button variant="outline" onClick={() => setSelectedArea(null)}>
            Clear Selection
          </Button>
        )}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2"
        >
          <GoogleMapComponent
            parkingAreas={parkingAreasWithOccupancy}
            onAreaSelect={handleAreaSelect}
          />
        </motion.div>

        {/* Area Details */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-4"
        >
          {selectedArea ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{selectedArea.name}</span>
                    <Button
                      size="sm"
                      onClick={() => {
                        const url = `https://www.google.pt/maps/search/${encodeURIComponent(selectedArea.name)}/@${selectedArea.lat},${selectedArea.lng},17z`
                        window.open(url, '_blank')
                      }}
                      variant="outline"
                    >
                      📍 Google Maps
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Total Slots:</span>
                      <span className="font-medium">{selectedArea.total_slots}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-green-500 rounded"></div>
                        <span>Free:</span>
                      </span>
                      <span className="font-medium text-green-600">{selectedArea.freeSlots}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-red-500 rounded"></div>
                        <span>Occupied:</span>
                      </span>
                      <span className="font-medium text-red-600">{selectedArea.occupiedSlots}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-yellow-500 rounded"></div>
                        <span>Reserved:</span>
                      </span>
                      <span className="font-medium text-yellow-600">{selectedArea.reservedSlots}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Occupancy:</span>
                      <span className="font-medium">{selectedArea.occupancyPercentage.toFixed(1)}%</span>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t">
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>Latitude: {selectedArea.lat.toFixed(6)}</div>
                      <div>Longitude: {selectedArea.lng.toFixed(6)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Availability Indicator */}
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold mb-2">
                      {selectedArea.freeSlots > 0 ? (
                        <span className="text-green-600">Available</span>
                      ) : (
                        <span className="text-red-600">Full</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600">
                      {selectedArea.freeSlots} of {selectedArea.total_slots} slots free
                    </div>
                    <div className="mt-4 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${(selectedArea.freeSlots / selectedArea.total_slots) * 100}%`
                        }}
                      ></div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="pt-6 text-center text-gray-500">
                <p>Click on a parking area marker to view details and navigate to dashboard</p>
                <div className="mt-4 text-sm">
                  <div className="flex justify-center space-x-4">
                    <span className="flex items-center space-x-1">
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <span>Available</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                      <span>Busy</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span>Full</span>
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>
      </div>
    </div>
  )
}