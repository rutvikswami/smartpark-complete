import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { Database } from '@/lib/supabase.ts'

type Slot = Database['public']['Tables']['slots']['Row']

interface SlotGridProps {
  slots: Slot[]
  onReserveSlot: (slotId: string) => void
  userReservations: string[]
}

export function SlotGrid({ slots, onReserveSlot, userReservations }: SlotGridProps) {
  const getSlotColor = (status: Slot['status']) => {
    switch (status) {
      case 'free':
        return 'bg-green-500 hover:bg-green-600'
      case 'occupied':
        return 'bg-red-500'
      case 'reserved':
        return 'bg-yellow-500'
      default:
        return 'bg-gray-500'
    }
  }

  const getStatusText = (status: Slot['status']) => {
    switch (status) {
      case 'free':
        return 'Free'
      case 'occupied':
        return 'Occupied'
      case 'reserved':
        return 'Reserved'
      default:
        return 'Unknown'
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
          {slots.map((slot, index) => (
            <motion.div
              key={slot.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="relative"
            >
              <Button
                className={`w-full h-12 text-white font-medium ${getSlotColor(slot.status)}`}
                disabled={slot.status !== 'free'}
                onClick={() => slot.status === 'free' && onReserveSlot(slot.id)}
              >
                <div className="text-center">
                  <div className="text-xs">{slot.slot_number}</div>
                  <div className="text-[10px] opacity-90">{getStatusText(slot.status)}</div>
                </div>
              </Button>
              {userReservations.includes(slot.id) && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full"></div>
              )}
            </motion.div>
          ))}
        </div>
        
        <div className="flex justify-center space-x-6 mt-6 text-sm">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span>Free</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span>Occupied</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-yellow-500 rounded"></div>
            <span>Reserved</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}