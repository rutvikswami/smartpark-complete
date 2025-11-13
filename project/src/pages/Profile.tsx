import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Calendar, Clock, MapPin, Car } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase.ts'
import toast from 'react-hot-toast'
import type { Database } from '@/lib/supabase.ts'

type Reservation = Database['public']['Tables']['reservations']['Row'] & {
  slots: {
    slot_number: number
    parking_areas: {
      name: string
    }
  }
}

export function Profile() {
  const { user, signOut } = useAuth()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) return

    const fetchReservations = async () => {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('reservations')
        .select(`
          *,
          slots:slot_id (
            slot_number,
            parking_areas:parking_area_id (
              name
            )
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching reservations:', error)
        toast.error('Failed to load reservations')
      } else if (data) {
        setReservations(data as Reservation[])
      }
      setIsLoading(false)
    }

    fetchReservations()
  }, [user])

  const handleCancelReservation = async (reservationId: string, slotId: string) => {
    const { error: reservationError } = await supabase
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', reservationId)

    if (reservationError) {
      console.error('Error cancelling reservation:', reservationError)
      toast.error('Failed to cancel reservation')
      return
    }

    // Update slot status back to free
    const { error: slotError } = await supabase
      .from('slots')
      .update({ status: 'free' })
      .eq('id', slotId)

    if (slotError) {
      console.error('Error updating slot status:', slotError)
    }

    // Update local state
    setReservations(prev =>
      prev.map(res =>
        res.id === reservationId
          ? { ...res, status: 'cancelled' as const }
          : res
      )
    )

    toast.success('Reservation cancelled successfully')
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-600 bg-green-100'
      case 'completed':
        return 'text-blue-600 bg-blue-100'
      case 'cancelled':
        return 'text-red-600 bg-red-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const activeReservations = reservations.filter(r => r.status === 'active')
  const pastReservations = reservations.filter(r => r.status !== 'active')

  if (!user) {
    return <div>Please log in to view your profile.</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-center"
      >
        <h1 className="text-3xl font-bold">Profile</h1>
        <Button variant="outline" onClick={() => signOut()}>
          Sign Out
        </Button>
      </motion.div>

      {/* User Info */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Car className="h-5 w-5" />
              <span>Account Information</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Email:</span>
                <span className="font-medium">{user.email}</span>
              </div>
              <div className="flex justify-between">
                <span>Member Since:</span>
                <span className="font-medium">
                  {new Date(user.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Total Reservations:</span>
                <span className="font-medium">{reservations.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Active Reservations */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Clock className="h-5 w-5 text-green-600" />
              <span>Active Reservations ({activeReservations.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-4">Loading reservations...</div>
            ) : activeReservations.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                No active reservations
              </div>
            ) : (
              <div className="space-y-4">
                {activeReservations.map((reservation) => (
                  <div
                    key={reservation.id}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="font-medium flex items-center space-x-2">
                          <MapPin className="h-4 w-4" />
                          <span>{reservation.slots?.parking_areas?.name}</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          Slot #{reservation.slots?.slot_number}
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(reservation.status)}`}>
                          {reservation.status}
                        </span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">Start:</span>{' '}
                        {formatDate(reservation.start_time)}
                      </div>
                      <div>
                        <span className="text-gray-500">End:</span>{' '}
                        {formatDate(reservation.end_time)}
                      </div>
                    </div>
                    
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCancelReservation(reservation.id, reservation.slot_id)}
                      >
                        Cancel Reservation
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Reservation History */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Calendar className="h-5 w-5" />
              <span>Reservation History</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pastReservations.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                No past reservations
              </div>
            ) : (
              <div className="space-y-4">
                {pastReservations.slice(0, 10).map((reservation) => (
                  <div
                    key={reservation.id}
                    className="border rounded-lg p-4 space-y-2 opacity-75"
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="font-medium flex items-center space-x-2">
                          <MapPin className="h-4 w-4" />
                          <span>{reservation.slots?.parking_areas?.name}</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          Slot #{reservation.slots?.slot_number}
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(reservation.status)}`}>
                        {reservation.status}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-500">
                      {formatDate(reservation.start_time)} - {formatDate(reservation.end_time)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}