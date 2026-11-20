import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Communication } from "./Communication";
import { readDirectCall } from "../utils/directCall";

/**
 * Route for account-to-account calls. The session id never appears in the
 * URL; it is read from this tab's sessionStorage (written on call-started).
 */
export function DirectCall() {
  const navigate = useNavigate();
  const direct = readDirectCall();

  useEffect(() => {
    if (!direct) navigate("/", { replace: true });
  }, [direct, navigate]);

  if (!direct) return null;
  return <Communication directCall={direct} />;
}
