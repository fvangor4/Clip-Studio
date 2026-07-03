import { Route, Routes } from "react-router-dom";
import { BatchScreen } from "./screens/BatchScreen";
import { ReviewScreen } from "./screens/ReviewScreen";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<BatchScreen />} />
      <Route path="/review/:id" element={<ReviewScreen />} />
    </Routes>
  );
}
