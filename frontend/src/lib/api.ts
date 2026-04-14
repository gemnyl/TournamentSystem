import axios from "axios";
import { getCsrfToken } from "./csrf";
import { toast } from "@/hooks/use-toast";

/**
 * Центральний axios instance для всіх REST-запитів.
 *
 * Ключові налаштування:
 * - withCredentials: true — щоб браузер надсилав Django sessionid cookie
 * - // TODO: CSRF header
    return list(slots)
