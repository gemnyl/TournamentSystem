import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { authApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import {
  User as UserIcon,
  Shield,
  FileCheck,
  Camera,
  Calendar,
  Phone,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RoleRequest } from "@/types/api";
import { ImageCropperDialog } from "@/components/ui/image-cropper-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ProfilePage() {
  const { user, updateProfile, changePassword } = useAuth();
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "roles">("profile");

  // Profile Form States
  const [firstName, setFirstName] = useState(user?.first_name || "");
  const [lastName, setLastName] = useState(user?.last_name || "");
  const [patronymic, setPatronymic] = useState(user?.patronymic || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [birthDate, setBirthDate] = useState(user?.birth_date || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [skillLevel, setSkillLevel] = useState(user?.skill_level || "");
  const [refereeCategory, setRefereeCategory] = useState(user?.referee_category || "");

  // Avatar uploading state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.photo || null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Security Form States
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Role upgrade States
  const [requestedRole, setRequestedRole] = useState<"coach" | "judge" | "organizer" | "">("");
  const [clubName, setClubName] = useState("");
  const [reqRefereeCategory, setReqRefereeCategory] = useState("");
  const [reqDetails, setReqDetails] = useState("");
  const [roleRequests, setRoleRequests] = useState<RoleRequest[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [photoWithIdFile, setPhotoWithIdFile] = useState<File | null>(null);
  const photoWithIdFileInputRef = useRef<HTMLInputElement>(null);

  // Photo cropper states
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);
  const [isSubmittingRole, setIsSubmittingRole] = useState(false);

  // Sync profile data from auth store when user object loads
  useEffect(() => {
    if (user) {
      setFirstName(user.first_name || "");
      setLastName(user.last_name || "");
      setPatronymic(user.patronymic || "");
      setPhone(user.phone || "");
      setBirthDate(user.birth_date || "");
      setGender(user.gender || "");
      setSkillLevel(user.skill_level || "");
      setRefereeCategory(user.referee_category || "");
      setAvatarPreview(user.photo || null);
    }
  }, [user]);

  // Fetch role requests history
  const fetchRoleRequests = () => {
    authApi.get<RoleRequest[]>("/role-requests/")
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : (res.data as { results?: RoleRequest[] }).results || [];
        setRoleRequests(list);
      })
      .catch((err) => console.error("Error fetching role requests", err));
  };

  useEffect(() => {
    if (user) {
      fetchRoleRequests();
    }
  }, [user]);

  // Handle Profile Photo selection
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith("image/")) {
        toast({
          variant: "destructive",
          title: "Некоректний формат файлу",
          description: "Будь ласка, виберіть зображення (JPEG, PNG, WebP тощо).",
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }

      const maxSizeBytes = 10 * 1024 * 1024; // 10 MB
      if (file.size > maxSizeBytes) {
        toast({
          variant: "destructive",
          title: "Файл занадто великий",
          description: "Будь ласка, виберіть зображення розміром менше 10 МБ.",
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }
      setPendingFile(file);
      setIsCropperOpen(true);
    }
  };

  const handleCroppedPhotoConfirm = async (croppedFile: File) => {
    setIsCropperOpen(false);
    setPendingFile(null);
    setIsUploadingAvatar(true);
    setAvatarPreview(URL.createObjectURL(croppedFile));

    try {
      const formData = new FormData();
      formData.append("photo", croppedFile);

      await updateProfile(formData);
      toast({
        title: "Фото профілю оновлено",
        description: "Ваш новий аватар успішно збережено.",
      });
      setAvatarFile(null);
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Помилка завантаження",
        description: "Не вдалося зберегти нове фото.",
      });
      setAvatarPreview(user?.photo || null);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    try {
      const formData = new FormData();
      formData.append("first_name", firstName);
      formData.append("last_name", lastName);
      formData.append("patronymic", patronymic);
      formData.append("phone", phone);
      formData.append("gender", gender);
      if (birthDate) formData.append("birth_date", birthDate);
      formData.append("skill_level", skillLevel);
      formData.append("referee_category", refereeCategory);

      if (avatarFile) {
        formData.append("photo", avatarFile);
      }

      await updateProfile(formData);
      toast({
        title: "Профіль оновлено",
        description: "Ваші зміни були успішно збережені.",
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSecuritySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Нові паролі не збігаються.",
      });
      return;
    }

    setIsSavingSecurity(true);
    try {
      await changePassword({
        old_password: oldPassword,
        new_password: newPassword,
        new_password_confirm: confirmPassword,
      });
      toast({
        title: "Пароль змінено",
        description: "Ваш пароль успішно змінено.",
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingSecurity(false);
    }
  };

  const handleRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestedRole) return;

    if (requestedRole === "coach" && !clubName.trim()) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Для ролі тренера назва клубу є обов'язковою.",
      });
      return;
    }

    if (requestedRole === "judge" && !reqRefereeCategory.trim()) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Суддівська категорія є обов'язковою для судді.",
      });
      return;
    }

    setIsSubmittingRole(true);
    try {
      const formData = new FormData();
      formData.append("requested_role", requestedRole);
      formData.append("details", reqDetails);
      if (requestedRole === "coach") {
        formData.append("club_name", clubName.trim());
      }
      if (requestedRole === "judge") {
        formData.append("referee_category", reqRefereeCategory);
      }
      if (documentFile) {
        formData.append("document", documentFile);
      }
      if (photoWithIdFile) {
        formData.append("photo_with_id", photoWithIdFile);
      }

      await authApi.post("/role-requests/", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      toast({
        title: "Запит надіслано",
        description: "Заявку на верифікацію ролі успішно надіслано адміністратору.",
      });
      setRequestedRole("");
      setClubName("");
      setReqRefereeCategory("");
      setReqDetails("");
      setDocumentFile(null);
      setPhotoWithIdFile(null);
      if (docFileInputRef.current) {
        docFileInputRef.current.value = "";
      }
      if (photoWithIdFileInputRef.current) {
        photoWithIdFileInputRef.current.value = "";
      }
      fetchRoleRequests();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingRole(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">Адміністратор</span>;
      case "staff":
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">Персонал</span>;
      case "organizer":
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">Організатор</span>;
      case "coach":
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Тренер</span>;
      case "judge":
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Суддя</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">Глядач</span>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return (
          <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" /> Схвалено
          </span>
        );
      case "rejected":
        return (
          <span className="flex items-center gap-1 text-red-400 text-xs font-semibold bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
            <XCircle className="w-3 h-3" /> Відхилено
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-amber-400 text-xs font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
            <Clock className="w-3 h-3 animate-pulse" /> Очікує
          </span>
        );
    }
  };

  const translateRole = (role: string) => {
    const map: Record<string, string> = {
      coach: "Тренер",
      judge: "Суддя",
      organizer: "Організатор",
      spectator: "Глядач",
      admin: "Адміністратор",
      staff: "Персонал",
    };
    return map[role] || role;
  };

  const hasPendingRequest = roleRequests.some((r) => r.status === "pending");

  return (
    <div className="container max-w-6xl mx-auto py-10 px-4 md:px-8">
      {/* Шапка профілю */}
      <div className="relative bg-slate-900/60 border border-slate-800 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row items-center gap-6 mb-10 overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/5 blur-3xl rounded-full pointer-events-none" />

        {/* Аватарка */}
        <div className="relative group">
          <div className="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-2 border-slate-700 bg-slate-800 flex items-center justify-center relative shadow-lg shadow-black/40">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Аватар користувача" className="w-full h-full object-cover" />
            ) : (
              <UserIcon className="w-12 h-12 md:w-16 md:h-16 text-slate-500" />
            )}
            {isUploadingAvatar && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-full">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={isUploadingAvatar}
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-1 right-1 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 p-2 rounded-full shadow-lg transition-transform active:scale-95 duration-200"
            title="Завантажити фото"
          >
            {isUploadingAvatar ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Camera className="w-4 h-4" />
            )}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handlePhotoChange}
            accept="image/*"
            className="hidden"
          />
        </div>

        {/* Загальна інфо */}
        <div className="flex-1 text-center md:text-left">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-3 mb-2">
            <h1 className="text-2xl md:text-3xl font-display font-bold text-white">
              {user?.first_name} {user?.last_name}
            </h1>
            <div className="flex gap-2">
              {getRoleBadge(user?.role || "spectator")}
              {user?.email_verified && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3" /> Верифікований
                </span>
              )}
            </div>
          </div>
          <p className="text-slate-400 font-medium">{user?.email}</p>
          {user?.club && (
            <p className="text-slate-500 text-sm mt-1">
              Клуб: <span className="text-amber-500/90 font-semibold">{user.club.name}</span>
            </p>
          )}
          <p className="text-xs text-slate-600 mt-2">
            Зареєстрований: {user?.date_joined ? new Date(user.date_joined).toLocaleDateString() : ""}
          </p>
        </div>
      </div>

      {/* Контент та таби */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Меню табів */}
        <div className="flex flex-row lg:flex-col overflow-x-auto lg:overflow-x-visible gap-2 p-1 bg-slate-900/40 border border-slate-800 rounded-2xl h-fit">
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex items-center justify-center lg:justify-start gap-2.5 px-4 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
              activeTab === "profile"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/40"
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Мій профіль</span>
          </button>
          <button
            onClick={() => setActiveTab("security")}
            className={`flex items-center justify-center lg:justify-start gap-2.5 px-4 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
              activeTab === "security"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/40"
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Безпека</span>
          </button>
          <button
            onClick={() => setActiveTab("roles")}
            className={`flex items-center justify-center lg:justify-start gap-2.5 px-4 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
              activeTab === "roles"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10"
                : "text-slate-400 hover:text-white hover:bg-slate-800/40"
            }`}
          >
            <FileCheck className="w-4 h-4" />
            <span>Верифікація ролей</span>
          </button>
        </div>

        {/* Панель контенту */}
        <div className="lg:col-span-3 bg-slate-900/20 border border-slate-800/80 rounded-3xl p-6 md:p-8 relative">

          {/* ТАБ: Мій Профіль */}
          {activeTab === "profile" && (
            <form onSubmit={handleProfileSubmit} className="space-y-6">
              <div>
                <h2 className="text-xl font-display font-bold text-white mb-1">Особисті дані</h2>
                <p className="text-xs text-slate-500">Оновіть ваші персональні відомості профілю</p>
              </div>

              {(!user?.phone || !user?.birth_date) && (
                <div className="p-4 border border-amber-500/20 bg-amber-500/5 rounded-2xl text-slate-300 text-xs md:text-sm leading-relaxed flex gap-3 items-start animate-pulse">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h4 className="font-bold text-amber-500">Завершення реєстрації</h4>
                    <p className="mt-0.5 text-slate-400">
                      Будь ласка, вкажіть ваш номер телефону та дату народження.
                      {!user?.name_locked && (
                        <span> Також перевірте та введіть ваші офіційні Прізвище, Ім'я та По батькові (ПІБ) — після першого збереження вони будуть заблоковані.</span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="last_name">Прізвище</Label>
                  <Input
                    id="last_name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    readOnly={user?.name_locked}
                    className={user?.name_locked ? "bg-slate-900/50 text-slate-400 border-slate-800/80 cursor-not-allowed select-none focus-visible:ring-0" : ""}
                    title={user?.name_locked ? "Для зміни ПІБ зверніться до адміністратора" : ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="first_name">Ім'я</Label>
                  <Input
                    id="first_name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    readOnly={user?.name_locked}
                    className={user?.name_locked ? "bg-slate-900/50 text-slate-400 border-slate-800/80 cursor-not-allowed select-none focus-visible:ring-0" : ""}
                    title={user?.name_locked ? "Для зміни ПІБ зверніться до адміністратора" : ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="patronymic">По-батькові</Label>
                  <Input
                    id="patronymic"
                    value={patronymic}
                    onChange={(e) => setPatronymic(e.target.value)}
                    readOnly={user?.name_locked}
                    className={user?.name_locked ? "bg-slate-900/50 text-slate-400 border-slate-800/80 cursor-not-allowed select-none focus-visible:ring-0" : ""}
                    title={user?.name_locked ? "Для зміни ПІБ зверніться до адміністратора" : ""}
                  />
                </div>
                <div className="md:col-span-2 text-[11px] text-slate-500 italic mt-0.5">
                  {user?.name_locked ? (
                    "* Зміна Прізвища, Імені та По-батькові заблокована. Для виправлення помилок у ПІБ зверніться до адміністратора платформи."
                  ) : (
                    <span className="text-amber-500 font-semibold">
                      * Будь ласка, вкажіть ваші офіційні Прізвище, Ім'я та По-батькові українською мовою. Після першого збереження вони будуть заблоковані!
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Телефон</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+380"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="birth_date">Дата народження</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="birth_date"
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gender">Стать</Label>
                  <Select value={gender} onValueChange={(val: string) => setGender(val)}>
                    <SelectTrigger id="gender">
                      <SelectValue placeholder="Оберіть стать" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Чоловік</SelectItem>
                      <SelectItem value="female">Жінка</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Спеціальні поля для тренерів/суддів */}
              {(user?.role === "coach" || user?.role === "judge" || user?.role === "admin") && (
                <div className="border-t border-slate-800/80 pt-6 space-y-4">
                  <h3 className="text-md font-display font-semibold text-amber-500 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> Додаткова спортивна інформація
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="skill_level">Рівень майстерності (пояс/дан)</Label>
                      <Input
                        id="skill_level"
                        placeholder="Наприклад: 1 Дан, Чорний пояс"
                        value={skillLevel}
                        onChange={(e) => setSkillLevel(e.target.value)}
                      />
                    </div>

                    {(user?.role === "judge" || user?.role === "admin") && (
                      <div className="space-y-1.5">
                        <Label htmlFor="referee_category">Суддівська категорія</Label>
                        <Input
                          id="referee_category"
                          placeholder="Наприклад: Національна категорія"
                          value={refereeCategory}
                          onChange={(e) => setRefereeCategory(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <Button type="submit" variant="sport" disabled={isSavingProfile}>
                  {isSavingProfile ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Збереження...
                    </>
                  ) : (
                    "Зберегти зміни"
                  )}
                </Button>
              </div>
            </form>
          )}

          {/* ТАБ: Безпека */}
          {activeTab === "security" && (
            <form onSubmit={handleSecuritySubmit} className="space-y-6">
              <div>
                <h2 className="text-xl font-display font-bold text-white mb-1">Зміна пароля</h2>
                <p className="text-xs text-slate-500">Захистіть свій обліковий запис надійним паролем</p>
              </div>

              <div className="max-w-md space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="old_password">Поточний пароль</Label>
                  <Input
                    id="old_password"
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new_password">Новий пароль</Label>
                  <Input
                    id="new_password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm_password">Підтвердження нового пароля</Label>
                  <Input
                    id="confirm_password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex justify-start pt-2">
                <Button type="submit" variant="sport" disabled={isSavingSecurity}>
                  {isSavingSecurity ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Оновлення...
                    </>
                  ) : (
                    "Змінити пароль"
                  )}
                </Button>
              </div>
            </form>
          )}

          {/* ТАБ: Верифікація Ролей */}
          {activeTab === "roles" && (
            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-display font-bold text-white mb-1">Запити на верифікацію ролей</h2>
                <p className="text-xs text-slate-500">Подайте запит на зміну ролі або перевірте статус попередніх заявок</p>
              </div>

              {/* Статус поточної ролі */}
              <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800/80 flex justify-between items-center">
                <div>
                  <p className="text-xs text-slate-500 font-semibold uppercase">Поточний статус ролі</p>
                  <p className="text-lg font-bold text-white mt-0.5">{translateRole(user?.role || "spectator")}</p>
                </div>
                {getRoleBadge(user?.role || "spectator")}
              </div>

              {/* Форма подачі нової заявки */}
              {user?.role === "spectator" && (
                <div className="border border-slate-800 bg-slate-900/20 rounded-2xl p-6">
                  {hasPendingRequest ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mb-4 text-amber-500">
                        <Clock className="w-6 h-6 animate-pulse" />
                      </div>
                      <h4 className="font-bold text-white mb-1">Заявка на верифікацію очікує перевірки</h4>
                      <p className="text-slate-400 text-sm max-w-sm">
                        Ви вже надіслали запит на верифікацію. Будь ласка, зачекайте, поки адміністратор розгляне вашу заявку.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleRoleSubmit} className="space-y-4">
                      <h3 className="text-md font-bold text-white">Подати заявку на верифікацію</h3>

                      <div className="space-y-1.5">
                        <Label htmlFor="requested_role">Бажана роль</Label>
                        <Select
                          value={requestedRole}
                          onValueChange={(val) => setRequestedRole(val as "coach" | "judge" | "organizer" | "")}
                        >
                          <SelectTrigger id="requested_role">
                            <SelectValue placeholder="Оберіть роль" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="coach">Тренер</SelectItem>
                            <SelectItem value="judge">Суддя</SelectItem>
                            <SelectItem value="organizer">Організатор турнірів</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {requestedRole === "coach" && (
                        <div className="space-y-1.5 animate-fade-in">
                          <Label htmlFor="req_club">Ваш спортивний клуб</Label>
                          <Input
                            id="req_club"
                            placeholder="Введіть назву клубу (наприклад: СК Сакура)"
                            value={clubName}
                            onChange={(e) => setClubName(e.target.value)}
                            required
                          />
                        </div>
                      )}

                      {requestedRole === "judge" && (
                        <div className="space-y-1.5 animate-fade-in">
                          <Label htmlFor="req_ref_cat">Суддівська категорія</Label>
                          <Input
                            id="req_ref_cat"
                            placeholder="Вкажіть категорію (наприклад: Суддя 1 категорії)"
                            value={reqRefereeCategory}
                            onChange={(e) => setReqRefereeCategory(e.target.value)}
                            required
                          />
                        </div>
                      )}

                      {requestedRole && (
                        <div className="space-y-1.5 animate-fade-in">
                          <Label htmlFor="req_details">Супровідний лист / Досвід</Label>
                          <textarea
                            id="req_details"
                            rows={3}
                            placeholder="Опишіть ваш досвід роботи, сертифікати, досягнення..."
                            value={reqDetails}
                            onChange={(e) => setReqDetails(e.target.value)}
                            className="flex min-h-[80px] w-full rounded-md border border-slate-800 bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                      )}

                      {requestedRole && (
                        <div className="space-y-1.5 animate-fade-in">
                          <Label htmlFor="req_document">Підтверджуючий документ (сертифікат / ліцензія / диплом)</Label>
                          <Input
                            id="req_document"
                            type="file"
                            accept="image/*,.pdf"
                            ref={docFileInputRef}
                            onChange={(e) => {
                              const files = e.target.files;
                              if (files && files.length > 0) {
                                const file = files[0];
                                const maxSizeBytes = 10 * 1024 * 1024; // 10MB
                                if (file.size > maxSizeBytes) {
                                  toast({
                                    variant: "destructive",
                                    title: "Файл занадто великий",
                                    description: "Будь ласка, виберіть файл розміром менше 10 МБ.",
                                  });
                                  if (docFileInputRef.current) {
                                    docFileInputRef.current.value = "";
                                  }
                                  setDocumentFile(null);
                                  return;
                                }
                                setDocumentFile(file);
                              } else {
                                setDocumentFile(null);
                              }
                            }}
                          />
                          <p className="text-xs text-slate-500">
                            Дозволено завантажувати зображення або PDF файл розміром до 10 МБ.
                          </p>
                        </div>
                      )}

                      {requestedRole && (
                        <div className="space-y-1.5 animate-fade-in">
                          <Label htmlFor="req_photo_with_id">Фото з посвідченням біля обличчя (для підтвердження особи)</Label>
                          <Input
                            id="req_photo_with_id"
                            type="file"
                            accept="image/*"
                            ref={photoWithIdFileInputRef}
                            onChange={(e) => {
                              const files = e.target.files;
                              if (files && files.length > 0) {
                                const file = files[0];
                                const maxSizeBytes = 10 * 1024 * 1024; // 10MB
                                if (file.size > maxSizeBytes) {
                                  toast({
                                    variant: "destructive",
                                    title: "Файл занадто великий",
                                    description: "Будь ласка, виберіть зображення розміром менше 10 МБ.",
                                  });
                                  if (photoWithIdFileInputRef.current) {
                                    photoWithIdFileInputRef.current.value = "";
                                  }
                                  setPhotoWithIdFile(null);
                                  return;
                                }
                                setPhotoWithIdFile(file);
                              } else {
                                setPhotoWithIdFile(null);
                              }
                            }}
                          />
                          <p className="text-xs text-slate-500">
                            Будь ласка, зробіть селфі або фото, де ви тримаєте ваше посвідчення (паспорт або ліцензію) біля обличчя, так щоб було чітко видно дані та ваше обличчя.
                          </p>
                        </div>
                      )}

                      {requestedRole && (
                        <Button type="submit" variant="sport" className="w-full mt-2" disabled={isSubmittingRole}>
                          {isSubmittingRole ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Надсилання...
                            </>
                          ) : (
                            "Надіслати заявку на верифікацію"
                          )}
                        </Button>
                      )}
                    </form>
                  )}
                </div>
              )}

              {/* Список заявок */}
              <div className="space-y-4">
                <h3 className="text-md font-bold text-white">Історія заявок</h3>
                {roleRequests.length === 0 ? (
                  <p className="text-slate-500 text-sm">Ви ще не подавали заявок на верифікацію ролей.</p>
                ) : (
                  <div className="overflow-x-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900 border-b border-slate-800 text-xs text-slate-400 font-bold">
                          <th className="p-3">Дата подачі</th>
                          <th className="p-3">Роль</th>
                          <th className="p-3">Деталі запиту</th>
                          <th className="p-3">Статус</th>
                          <th className="p-3">Примітки перевірки</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-sm text-slate-300">
                        {roleRequests.map((req) => (
                          <tr key={req.id} className="hover:bg-slate-950/20">
                            <td className="p-3 whitespace-nowrap text-xs text-slate-500">
                              {new Date(req.created_at).toLocaleDateString()}
                            </td>
                            <td className="p-3 whitespace-nowrap font-semibold">
                              {translateRole(req.requested_role)}
                            </td>
                            <td className="p-3 max-w-[200px] text-slate-400 text-xs">
                              {req.requested_role === "coach" && req.club && (
                                <div className="font-semibold text-amber-500/90">{req.club.name}</div>
                              )}
                              {req.requested_role === "judge" && req.referee_category && (
                                <div className="font-semibold text-emerald-500/90">{req.referee_category}</div>
                              )}
                              {req.details && <div className="truncate mb-1" title={req.details}>{req.details}</div>}
                              {req.document && (
                                <div className="mt-1">
                                  <a href={req.document} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline inline-flex items-center gap-1 font-semibold">
                                    📎 Дивитись документ
                                  </a>
                                </div>
                              )}
                              {req.photo_with_id && (
                                <div className="mt-1">
                                  <a href={req.photo_with_id} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline inline-flex items-center gap-1 font-semibold">
                                    📸 Фото з посвідченням
                                  </a>
                                </div>
                              )}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              {getStatusBadge(req.status)}
                            </td>
                            <td className="p-3 text-slate-400 text-xs">
                              {req.review_notes || <span className="text-slate-600">-</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      </div>

      {/* Photo cropping dialog */}
      <ImageCropperDialog
        file={pendingFile}
        open={isCropperOpen}
        onClose={() => {
          setIsCropperOpen(false);
          setPendingFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }}
        onConfirm={handleCroppedPhotoConfirm}
      />
    </div>
  );
}
