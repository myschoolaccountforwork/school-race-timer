import { Route, Routes } from "react-router-dom";
import TrackEventScreen from "./features/events/TrackEventScreen";
import TrackEventCreatedScreen from "./features/events/TrackEventCreatedScreen";
import SwimEventScreen from "./features/events/SwimEventScreen";
import TimingOnlyScreen from "./features/events/TimingOnlyScreen";
import HomeScreen from "./features/home/HomeScreen";
import JoinScreen from "./features/home/JoinScreen";
import PracticeScreen from "./features/home/PracticeScreen";
import { AppRoute } from "./types/routes";

export default function App() {
  return (
    <Routes>
      <Route path={AppRoute.HOME} element={<HomeScreen />} />
      <Route path={AppRoute.TRACK} element={<TrackEventScreen />} />
      <Route path={AppRoute.TRACK_CREATED} element={<TrackEventCreatedScreen />} />
      <Route path={AppRoute.SWIM} element={<SwimEventScreen />} />
      <Route path={AppRoute.TIMING} element={<TimingOnlyScreen />} />
      <Route path={AppRoute.JOIN} element={<JoinScreen />} />
      <Route path={AppRoute.PRACTICE} element={<PracticeScreen />} />
    </Routes>
  );
}
