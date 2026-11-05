import { Suspense, lazy, useEffect } from 'react'
import { Route, Switch, Redirect, useLocation } from 'wouter'
import { useApp } from '@/store/app'
import { TabBar, Toaster, Spinner } from '@/ui'
import { ActiveWorkoutPill } from '@/screens/workout/ActiveWorkoutPill'

const HomeScreen = lazy(() => import('@/screens/home/HomeScreen'))
const WelcomeScreen = lazy(() => import('@/screens/welcome/WelcomeScreen'))
const RoutinesScreen = lazy(() => import('@/screens/routines/RoutinesScreen'))
const RoutineEditorScreen = lazy(() => import('@/screens/routines/RoutineEditorScreen'))
const ExerciseLibraryScreen = lazy(() => import('@/screens/exercises/ExerciseLibraryScreen'))
const ExerciseDetailScreen = lazy(() => import('@/screens/exercises/ExerciseDetailScreen'))
const WorkoutScreen = lazy(() => import('@/screens/workout/WorkoutScreen'))
const SummaryScreen = lazy(() => import('@/screens/summary/SummaryScreen'))
const ProgressScreen = lazy(() => import('@/screens/progress/ProgressScreen'))
const ProfileScreen = lazy(() => import('@/screens/profile/ProfileScreen'))

/** Screens that take the whole viewport (no tab bar). */
const FULLSCREEN = [/^\/workout/, /^\/welcome/, /^\/summary/]

function useThemeAttr() {
  const theme = useApp((s) => s.settings.theme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])
}

function Splash() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <Spinner />
    </div>
  )
}

export function App() {
  const hydrated = useApp((s) => s.hydrated)
  const onboarded = useApp((s) => s.profile.onboarded)
  const [path] = useLocation()
  useThemeAttr()

  if (!hydrated) return <Splash />

  const fullscreen = FULLSCREEN.some((r) => r.test(path))

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <i />
      </div>
      <div className="app-frame">
        <Suspense fallback={<Splash />}>
          <Switch>
            <Route path="/welcome" component={WelcomeScreen} />
            <Route path="/">{onboarded ? <HomeScreen /> : <Redirect to="/welcome" replace />}</Route>
            <Route path="/routines" component={RoutinesScreen} />
            <Route path="/routines/:id" component={RoutineEditorScreen} />
            <Route path="/exercises" component={ExerciseLibraryScreen} />
            <Route path="/exercises/:id" component={ExerciseDetailScreen} />
            <Route path="/workout" component={WorkoutScreen} />
            <Route path="/summary/:id" component={SummaryScreen} />
            <Route path="/history/:id" component={SummaryScreen} />
            <Route path="/progress" component={ProgressScreen} />
            <Route path="/profile" component={ProfileScreen} />
            <Route>
              <Redirect to="/" replace />
            </Route>
          </Switch>
        </Suspense>
      </div>
      {!fullscreen && <ActiveWorkoutPill />}
      {!fullscreen && <TabBar />}
      <Toaster />
    </>
  )
}
