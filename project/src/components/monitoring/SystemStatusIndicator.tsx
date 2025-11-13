import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Activity, AlertCircle, CheckCircle, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase.ts'
import type { Database } from '@/lib/supabase.ts'

type SystemStatus = Database['public']['Tables']['system_status']['Row']

interface StatusIndicatorProps {
  location?: string
  systemId?: string  // Add systemId prop to specify which system to monitor
}

export function SystemStatusIndicator({ location, systemId }: StatusIndicatorProps) {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [statusLevel, setStatusLevel] = useState<'healthy' | 'warning' | 'critical'>('critical')
  const [lastSeenText, setLastSeenText] = useState<string>('')

  const fetchSystemStatus = async (isInitial = false) => {
    try {
      // Use provided systemId or default to tech park whitefield
      const targetSystemId = systemId || 'parking_monitor_tech_park_whitefield'
      
      const { data, error } = await supabase
        .from('system_status')
        .select('*')
        .eq('system_id', targetSystemId)
        .single()

      if (error) {
        setSystemStatus(null)
        setStatusLevel('critical')
        setLastSeenText('Never')
        return
      }

      if (data) {
        setSystemStatus(data)
        calculateStatusLevel(data.last_heartbeat, data.status)
      }
    } catch (err) {
      setSystemStatus(null)
      setStatusLevel('critical')
      setLastSeenText('Error')
    }
  }

  const calculateStatusLevel = (lastHeartbeat: string, currentStatus: string) => {
      const now = new Date()
      const heartbeatTime = new Date(lastHeartbeat)
      const diffMinutes = Math.floor((now.getTime() - heartbeatTime.getTime()) / (1000 * 60))

      // Primary logic: Use database status field
      if (currentStatus === 'online') {
        // System is actively running - show green
        setStatusLevel('healthy')
        setLastSeenText(diffMinutes === 0 ? 'Just now' : `${diffMinutes} min ago`)
      } else if (currentStatus === 'offline') {
        // System explicitly set to offline - show red
        setStatusLevel('critical')
        if (diffMinutes < 60) {
          setLastSeenText(`${diffMinutes} min ago`)
        } else {
          const hours = Math.floor(diffMinutes / 60)
          setLastSeenText(`${hours}h ago`)
        }
      } else {
        // Unknown status - show red
        setStatusLevel('critical')
        setLastSeenText('Unknown')
      }
    }

  useEffect(() => {
    // Reset state when systemId changes
    setSystemStatus(null)
    setStatusLevel('critical')
    setLastSeenText('Loading...')
    
    // Initial fetch only
    fetchSystemStatus(true)

    // Subscribe to real-time updates
    const targetSystemId = systemId || 'parking_monitor_tech_park_whitefield'
    const channel = supabase
      .channel(`system-status-${targetSystemId}`)
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'system_status' },
        (payload) => {
          if (payload.new && (payload.new as SystemStatus).system_id === targetSystemId) {
            const newStatus = payload.new as SystemStatus
            setSystemStatus(newStatus)
            calculateStatusLevel(newStatus.last_heartbeat, newStatus.status)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [systemId])

  // Separate useEffect for time updates to avoid stale closure
  useEffect(() => {
    const timeInterval = setInterval(() => {
      if (systemStatus?.last_heartbeat && systemStatus?.status) {
        calculateStatusLevel(systemStatus.last_heartbeat, systemStatus.status)
      }
    }, 30000)

    return () => {
      clearInterval(timeInterval)
    }
  }, [systemStatus])

  const getStatusConfig = () => {
    switch (statusLevel) {
      case 'healthy':
        return {
          icon: CheckCircle,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          label: 'Online',
          description: 'Monitoring system is running normally'
        }
      case 'warning':
        return {
          icon: AlertCircle,
          color: 'text-yellow-600',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          label: 'Warning',
          description: 'Last update was a few minutes ago'
        }
      case 'critical':
        return {
          icon: AlertCircle,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          label: 'Offline',
          description: 'Monitoring system appears to be down'
        }
    }
  }

  const config = getStatusConfig()
  const StatusIcon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full"
    >
      <Card className={`${config.bgColor} ${config.borderColor} border-2`}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-xs sm:text-sm font-medium">
            <span className="flex items-center space-x-1 sm:space-x-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="hidden sm:inline">Monitoring System</span>
              <span className="sm:hidden">Monitor</span>
            </span>
            <motion.div
              animate={{ 
                scale: statusLevel === 'healthy' ? [1, 1.1, 1] : 1 
              }}
              transition={{ 
                duration: 2, 
                repeat: statusLevel === 'healthy' ? Infinity : 0 
              }}
            >
              <StatusIcon className={`h-5 w-5 ${config.color}`} />
            </motion.div>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold ${config.color}`}>
                {config.label}
              </span>
              <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{lastSeenText}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {config.description}
            </p>
            {systemStatus?.location && (
              <p className="text-xs text-muted-foreground">
                Location: {systemStatus.location}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}