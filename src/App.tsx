import { Navigate, Route, Routes } from "react-router-dom";
import TrackEventScreen from "./features/events/TrackEventScreen";
import TrackEventControlCentre from "./features/events/TrackEventControlCentre";
import Marshal1EntryScreen from "./features/marshal1/Marshal1EntryScreen";
import Marshal2Screen from "./features/marshal2/Marshal2Screen";
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
      <Route
        path={AppRoute.TRACK_CONTROL}
        element={<TrackEventControlCentre />}
      />
      <Route
        path={AppRoute.TRACK_CREATED}
        element={<Navigate to={AppRoute.TRACK_CONTROL} replace />}
      />
      <Route path={AppRoute.TRACK_ENTRY} element={<Marshal1EntryScreen />} />
      <Route path={AppRoute.MARSHAL_2} element={<Marshal2Screen />} />
      <Route path={AppRoute.SWIM} element={<SwimEventScreen />} />
      <Route path={AppRoute.TIMING} element={<TimingOnlyScreen />} />
      <Route path={AppRoute.JOIN} element={<JoinScreen />} />
      <Route path={AppRoute.PRACTICE} element={<PracticeScreen />} />
    </Routes>
  );
}
