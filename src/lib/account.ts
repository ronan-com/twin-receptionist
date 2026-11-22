import { createContext, useContext } from "react";
import type { Account } from "./shared";

// The signed-in account, for components deep in the page that need to know who is looking.
export const AccountContext = createContext<Account | null>(null);
export const useAccount = () => useContext(AccountContext);
