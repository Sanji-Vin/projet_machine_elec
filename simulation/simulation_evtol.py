"""
Simulation d'un taxi-drone eVTOL (multicoptère 8 rotors)
propulsé par des moteurs synchrones à aimants permanents (MSAP).

Ce script :
  1. définit les paramètres du drone, des rotors, des moteurs et de la batterie ;
  2. calcule les courbes caractéristiques (rotor, moteur, rendement, comparaison MCC/MAS/MS) ;
  3. simule une mission complète (décollage -> croisière -> atterrissage) ;
  4. simule une panne moteur en vol stationnaire ;
  5. exporte les figures (dossier figures/) et les données pour la présentation web.

Lancer :  python simulation/simulation_evtol.py
"""
import json
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
DOSSIER_FIG = os.path.join(RACINE, "figures")
FICHIER_WEB = os.path.join(RACINE, "presentation", "data", "sim.js")
os.makedirs(DOSSIER_FIG, exist_ok=True)
os.makedirs(os.path.dirname(FICHIER_WEB), exist_ok=True)

# =============================================================================
# 1. PARAMÈTRES
# =============================================================================
RHO, G = 1.225, 9.81                 # masse volumique de l'air (kg/m3), gravité

# --- Drone (fictif : "VX-8") ---
M = 950.0                            # masse max au décollage (kg)
N_ROT = 8                            # nombre de rotors
D = 2.0                              # diamètre d'un rotor (m)
R_BRAS = 2.7                         # rayon du cercle des moteurs (m)
A_DISQUE = np.pi * D**2 / 4          # surface balayée par un rotor (m2)
CT, CP = 0.10, 0.035                 # coefficients de poussée et de puissance (n en tr/s)
CQ = CP / (2 * np.pi)                # coefficient de couple
KAPPA = 1.15                         # facteur de puissance induite (pertes non idéales)
F_TRAINEE = 2.5                      # surface équivalente de traînée du fuselage (m2)
J_ROT = 2.5                          # inertie rotor + hélice ramenée à l'arbre (kg.m2)
P_AUX = 3000.0                       # avionique, climatisation (W)

# --- Moteur synchrone à aimants permanents (un par rotor, entraînement direct) ---
P_POLES = 14                         # nombre de paires de pôles (moteur "outrunner" 28 pôles)
LAMBDA = 0.0575                      # flux des aimants (Wb)
RS = 0.025                           # résistance d'une phase (ohm)
LS = 100e-6                          # inductance synchrone (H)
I_MAX = 240.0                        # courant crête max (A)
C_MAX = 280.0                        # couple crête max (N.m)
P_MAX = 60e3                         # puissance crête max (W)
K_HYST, K_FOUC = 0.5, 0.002          # pertes fer : K_HYST*f + K_FOUC*f^2 (W)
C_FROT = 0.5                         # couple de frottement (roulements) (N.m)
ETA_OND = 0.98                       # rendement de l'onduleur (ESC)
R_TH, C_TH, T_AMB = 0.06, 6000.0, 25.0   # modèle thermique du bobinage
M_MOTEUR = 13.0                      # masse moteur (kg)
KT = 1.5 * P_POLES * LAMBDA          # constante de couple (N.m/A)

# --- Batterie Li-ion ---
N_SERIE = 108                        # cellules en série
E_BAT = 60e3                         # énergie (Wh)
Q_BAT = E_BAT / (N_SERIE * 3.7)      # capacité (Ah)
R_BAT = 0.06                         # résistance interne (ohm)


def tension_vide_batterie(soc):
    """Tension à vide de la batterie en fonction de l'état de charge (0..1)."""
    return N_SERIE * (3.40 + 0.80 * soc - 0.25 * np.exp(-15 * soc))


# =============================================================================
# 2. MODÈLE DU ROTOR (hélice)
# =============================================================================
def poussee(omega):
    """Poussée d'un rotor (N) en fonction de sa vitesse (rad/s) : T = CT.rho.n².D⁴"""
    n = omega / (2 * np.pi)
    return CT * RHO * n**2 * D**4


def omega_pour_poussee(T):
    return 2 * np.pi * np.sqrt(np.maximum(T, 0) / (CT * RHO * D**4))


def puissance_statique(omega):
    """Puissance absorbée par le rotor en stationnaire : P = CP.rho.n³.D⁵"""
    n = omega / (2 * np.pi)
    return CP * RHO * n**3 * D**5


def vitesse_induite(T, V, vc):
    """Vitesse induite (théorie de Froude-Glauert), résolue par Newton."""
    vh2 = np.maximum(T, 1e-6) / (2 * RHO * A_DISQUE)
    vh = np.sqrt(vh2)
    v = vh
    for _ in range(8):
        w = vc + v
        f = v**2 * (V**2 + w**2) - vh2**2
        df = 2 * v * (V**2 + w**2) + 2 * v**2 * w
        v = np.maximum(v - f / df, 1e-3)
    return v, vh


def puissance_rotor(omega, V=0.0, vc=0.0):
    """Puissance aérodynamique d'un rotor (W) : induite + montée + profil + parasite."""
    T = poussee(omega)
    vi, vh = vitesse_induite(T, V, vc)
    p0 = puissance_statique(omega) - KAPPA * T * vh          # puissance de profil (pales)
    mu = V / np.maximum(omega * D / 2, 1.0)
    p_par = 0.5 * RHO * F_TRAINEE * V**3 / N_ROT             # traînée du fuselage
    return KAPPA * T * vi + T * vc + p0 * (1 + 4.6 * mu**2) + p_par


# =============================================================================
# 3. MODÈLE DU MOTEUR SYNCHRONE (repère de Park d-q)
# =============================================================================
def pertes_fer(omega):
    f = P_POLES * omega / (2 * np.pi)
    return K_HYST * f + K_FOUC * f**2


def couple_pertes(omega):
    """Couple de pertes collectives (fer + mécaniques), comme dans le cours MCC."""
    return pertes_fer(omega) / np.maximum(omega, 1.0) + C_FROT


def point_fonctionnement(omega, Cu, Vdc):
    """
    Point de fonctionnement du moteur pour une vitesse (rad/s) et un couple utile (N.m).
    Commande id = 0, défluxage (id < 0) si la tension ne suffit pas.
    Retourne un dict avec courants, tension, pertes, rendement, faisabilité.
    """
    omega = np.asarray(omega, float)
    Cu = np.asarray(Cu, float)
    we = P_POLES * omega                          # pulsation électrique
    Vmax = 0.95 * Vdc / np.sqrt(3)                # tension crête de phase max (MLI)
    Cem = Cu + couple_pertes(omega)
    iq = Cem / KT
    # tension avec id = 0
    vd = -we * LS * iq
    vq = RS * iq + we * LAMBDA
    id_ = np.zeros_like(iq)
    trop = np.hypot(vd, vq) > Vmax
    # défluxage : on cherche id pour que |V| = Vmax
    reste = Vmax**2 - (we * LS * iq) ** 2
    psi_d = (np.sqrt(np.maximum(reste, 0)) - RS * iq) / np.maximum(we, 1e-6)
    id_fw = (psi_d - LAMBDA) / LS
    id_ = np.where(trop, np.minimum(id_fw, 0), 0.0)
    i_amp = np.hypot(id_, iq)
    faisable = (i_amp <= I_MAX) & (Cem <= C_MAX) & (Cu * omega <= P_MAX) & (reste > 0) | (Cu <= 0)
    p_cu = 1.5 * RS * i_amp**2
    p_fer = pertes_fer(omega)
    p_meca = C_FROT * omega
    p_u = Cu * omega
    p_abs = p_u + p_cu + p_fer + p_meca
    eta = np.where((p_abs > 1) & (p_u > 0), p_u / np.maximum(p_abs, 1e-9), 0)
    # en génératrice (freinage récupératif, p_abs < 0) l'onduleur renvoie p_abs*eta à la batterie
    p_dc = np.where(p_abs > 0, p_abs / ETA_OND, p_abs * ETA_OND)
    return dict(iq=iq, id=id_, i=i_amp, i_rms=i_amp / np.sqrt(2), Cem=Cem, p_cu=p_cu,
                p_fer=p_fer, p_meca=p_meca, p_u=p_u, p_abs=p_abs, p_dc=p_dc,
                eta=eta, faisable=faisable, f=we / (2 * np.pi))


def couple_max(omega, Vdc):
    """Enveloppe : couple utile max en fonction de la vitesse (bissection)."""
    omega = np.atleast_1d(np.asarray(omega, float))
    lo, hi = np.zeros_like(omega), np.full_like(omega, C_MAX)
    for _ in range(40):
        mid = (lo + hi) / 2
        ok = point_fonctionnement(omega, mid, Vdc)["faisable"] & (mid > 0)
        lo = np.where(ok, mid, lo)
        hi = np.where(ok, hi, mid)
    return lo


# Table pré-calculée de l'enveloppe (accélère la simulation temporelle)
_TAB_W = np.linspace(0, 400, 201)
_TAB_V = np.linspace(280, 480, 11)
_TAB_C = np.array([couple_max(np.maximum(_TAB_W, 0.5), v) for v in _TAB_V])
C_FREIN = 60.0                       # couple de freinage récupératif max (N.m)


def couple_max_rapide(omega, Vdc):
    """Couple max par interpolation dans la table (scalaire ou vecteur)."""
    j = np.clip((Vdc - _TAB_V[0]) / (_TAB_V[1] - _TAB_V[0]), 0, len(_TAB_V) - 1.001)
    j0 = int(j); a = j - j0
    return (1 - a) * np.interp(omega, _TAB_W, _TAB_C[j0]) + a * np.interp(omega, _TAB_W, _TAB_C[j0 + 1])


# =============================================================================
# 4. POINTS CLÉS (vol stationnaire, poussée max)
# =============================================================================
POIDS = M * G
T_STAT = POIDS / N_ROT
W_STAT = omega_pour_poussee(T_STAT)
P_ROT_STAT = puissance_rotor(W_STAT)
C_STAT = P_ROT_STAT / W_STAT
VDC_NOM = N_SERIE * 3.7
PF_STAT = point_fonctionnement(W_STAT, C_STAT, VDC_NOM)
T_MAXI = 2 * T_STAT                                 # marge de poussée x2 (manœuvre + panne)
W_MAXI = omega_pour_poussee(T_MAXI)
C_MAXI = puissance_rotor(W_MAXI) / W_MAXI
RPM = 60 / (2 * np.pi)

# Bilan de puissance en vol stationnaire (un moteur)
P_IDEALE = T_STAT * np.sqrt(T_STAT / (2 * RHO * A_DISQUE))     # Froude idéale
bilan = dict(
    p_dc=float(PF_STAT["p_dc"]),
    p_ond=float(PF_STAT["p_dc"] - PF_STAT["p_abs"]),
    p_cu=float(PF_STAT["p_cu"]), p_fer=float(PF_STAT["p_fer"]), p_meca=float(PF_STAT["p_meca"]),
    p_u=float(PF_STAT["p_u"]), p_ideale=float(P_IDEALE),
)

# =============================================================================
# 5. SIMULATION DE LA MISSION
# =============================================================================
def profil_mission():
    """Consignes : altitude h(t) et vitesse horizontale V(t), linéaires par morceaux."""
    th = [0, 6, 21, 31, 121, 801, 891, 906, 922.7, 932.7, 960]
    hh = [0, 0, 30, 30, 300, 300, 30, 30, 5, -0.5, -0.5]
    tv = [0, 31, 61, 831, 861, 960]
    vv = [0, 0, 25, 25, 0, 0]
    return np.array(th), np.array(hh, float), np.array(tv), np.array(vv, float)


def simuler_mission(dt=0.01):
    th, hh, tv, vv = profil_mission()
    t_fin = th[-1]
    n = int(t_fin / dt)
    t_decol = 6.0
    t_pose = None                         # instant du toucher (détecté)
    w_h = W_STAT
    # états
    om, z, vz, x, soc, Tw, integ = 0.0, 0.0, 0.0, 0.0, 1.0, T_AMB, 0.0
    hf, vf = 0.0, 0.0                     # générateur de consigne lissée (altitude)
    Vf, af_x = 0.0, 0.0                   # générateur de consigne lissée (vitesse)
    om_ref = 0.0
    Kp, Kd = 1.0, 1.6                     # régulateur d'altitude (PD + anticipation)
    Kw, Ki = 12.0, 30.0                   # régulateur de vitesse moteur (PI)
    wn_h, wn_v = 0.8, 0.35                # pulsations des filtres de consigne (rad/s)
    ecrire = int(0.25 / dt)
    S = {k: [] for k in ["t", "h", "h_ref", "V", "x", "rpm", "couple", "i_rms", "p_moteur",
                         "p_total", "eta", "soc", "v_bat", "i_bat", "temp", "poussee", "f_elec"]}
    energie = 0.0
    for k in range(n):
        t = k * dt
        # --- consignes lissées (filtres du 2e ordre amortis critiques) ---
        h_brut = np.interp(t, th, hh)
        af = wn_h**2 * (h_brut - hf) - 2 * wn_h * vf
        vf += af * dt; hf += vf * dt
        V_brut = np.interp(t, tv, vv)
        jx = wn_v**2 * (V_brut - Vf) - 2 * wn_v * af_x
        af_x += jx * dt; Vf += af_x * dt
        V, ax = max(Vf, 0.0), af_x
        traine = 0.5 * RHO * F_TRAINEE * V**2

        # --- loi de commande : consigne de vitesse des rotors ---
        if t < t_decol:
            om_cible = 0.85 * w_h * min(t / 5, 1)
        elif t_pose is not None:
            om_cible = 0.0
        else:
            a_cmd = af + Kp * (hf - z) + Kd * (vf - vz)
            Fz = M * (G + a_cmd)
            Fx = M * ax + traine
            om_cible = omega_pour_poussee(np.hypot(Fz, Fx) / N_ROT)
            if t > 900 and z <= 0.0 and hf < 0.3:
                t_pose = t                # toucher détecté -> arrêt des rotors
        # limiteur de pente de la consigne (60 rad/s²)
        om_ref += np.clip(om_cible - om_ref, -60 * dt, 60 * dt)

        # --- batterie ---
        voc = tension_vide_batterie(soc)
        vdc = voc - 40
        c_lim = couple_max_rapide(om, vdc)
        c_charge = puissance_rotor(om, V, vz) / max(om, 1.0) if om > 1 else 0.0
        err = om_ref - om
        integ = np.clip(integ + err * dt, -5, 5)
        Cu_cmd = c_charge + J_ROT * (Kw * err + Ki * integ)
        Cu = float(np.clip(Cu_cmd, -C_FREIN if om > 5 else 0.0, c_lim))

        pf = point_fonctionnement(om, Cu, vdc)
        p_dc_tot = N_ROT * float(pf["p_dc"]) + P_AUX
        i_bat = (voc - np.sqrt(max(voc**2 - 4 * R_BAT * p_dc_tot, 0))) / (2 * R_BAT)
        v_bat = voc - R_BAT * i_bat

        # --- dynamique du rotor : J dΩ/dt = Cu - C_charge ---
        om = max(om + dt * (Cu - c_charge) / J_ROT, 0.0)

        # --- dynamique verticale du drone ---
        T_tot_reel = N_ROT * poussee(om)
        cos_th = M * G / np.hypot(M * G, M * ax + traine)
        az = (T_tot_reel * cos_th - POIDS - 0.5 * RHO * 6.0 * vz * abs(vz)) / M
        vz += az * dt
        z += vz * dt
        if z <= 0:
            z, vz = 0.0, max(vz, 0.0)
        x += V * dt

        # --- batterie et thermique ---
        soc -= i_bat * dt / (Q_BAT * 3600)
        p_pertes = float(pf["p_cu"] + pf["p_fer"] + pf["p_meca"])
        Tw += dt * (p_pertes - (Tw - T_AMB) / R_TH) / C_TH
        energie += p_dc_tot * dt

        if k % ecrire == 0:
            S["t"].append(t); S["h"].append(z); S["h_ref"].append(max(hf, 0)); S["V"].append(V * 3.6)
            S["x"].append(x / 1000); S["rpm"].append(om * RPM); S["couple"].append(Cu)
            S["i_rms"].append(float(pf["i_rms"])); S["p_moteur"].append(float(pf["p_dc"]) / 1000)
            S["p_total"].append(p_dc_tot / 1000); S["eta"].append(float(pf["eta"]) * 100)
            S["soc"].append(soc * 100); S["v_bat"].append(v_bat); S["i_bat"].append(i_bat)
            S["temp"].append(Tw); S["poussee"].append(poussee(om)); S["f_elec"].append(float(pf["f"]))
    S = {k: np.round(np.array(v), 3) for k, v in S.items()}
    S["energie_kWh"] = energie / 3.6e6
    return S


# =============================================================================
# 6. PANNE D'UN MOTEUR EN VOL STATIONNAIRE
# =============================================================================
ANGLES = np.deg2rad(np.arange(N_ROT) * 45 + 22.5)
XM, YM = R_BRAS * np.cos(ANGLES), R_BRAS * np.sin(ANGLES)
SENS = np.array([1, -1] * (N_ROT // 2))             # sens de rotation alterné
Q_SUR_T = CQ * D / CT                               # rapport couple/poussée (m)
B_ALLOC = np.vstack([np.ones(N_ROT), YM, -XM, SENS * Q_SUR_T])   # [Fz, Mx, My, Mz] = B.T


def allocation(moteurs_actifs, F=POIDS, T_imposees=None):
    """
    Répartition des poussées pour équilibrer la force verticale et les 3 moments
    (solution de norme minimale). T_imposees : poussée des rotors inactifs (en ralentissement).
    """
    a = np.array(moteurs_actifs, bool)
    T = np.zeros(N_ROT) if T_imposees is None else np.array(T_imposees, float) * (~a)
    cible = np.array([F, 0, 0, 0]) - B_ALLOC[:, ~a] @ T[~a]
    T[a] = np.linalg.pinv(B_ALLOC[:, a]) @ cible
    return T


def court_circuit(omega):
    """
    Court-circuit triphasé d'un MSAP (V = 0) en régime établi :
      id = -we².L.λ / (R² + we².L²)     iq = -R.we.λ / (R² + we².L²)
    Couple de freinage = 1,5.p.λ.|iq|  ;  courant crête = λ.we / sqrt(R² + we².L²)
    """
    we = P_POLES * omega
    den = RS**2 + (we * LS) ** 2
    c = 1.5 * P_POLES * LAMBDA**2 * RS * we / den
    i = LAMBDA * we / np.sqrt(den)
    return c, i


def simuler_panne(dt=0.002, t_fin=8.0, t_panne=2.0, retard=0.15, moteur=0):
    """
    L'onduleur du moteur 1 tombe en panne : le rotor part en roue libre. Après un temps de
    détection, l'onduleur met le moteur en court-circuit actif (freinage) et le contrôleur
    de vol redistribue la poussée sur les 7 autres, en tenant compte de la poussée
    résiduelle du rotor qui ralentit.
    """
    n = int(t_fin / dt)
    actifs = np.ones(N_ROT, bool); actifs[moteur] = False
    om = np.full(N_ROT, W_STAT)
    om_ref = om.copy()
    z, vz = 30.0, 0.0
    integ = np.zeros(N_ROT)
    Kw, Ki = 12.0, 30.0
    S = {k: [] for k in ["t", "h", "rpm", "couple", "i_rms", "p_tot"]}
    for k in range(n):
        t = k * dt
        a_cmd = 1.0 * (30 - z) + 1.6 * (0 - vz)
        Fz = M * (G + a_cmd)
        if t >= t_panne + retard:
            T_cmd = allocation(actifs, Fz, poussee(om))
        else:
            T_cmd = np.full(N_ROT, Fz / N_ROT)
        om_cible = omega_pour_poussee(T_cmd)
        om_ref += np.clip(om_cible - om_ref, -150 * dt, 150 * dt)
        c_charge = puissance_rotor(om) / np.maximum(om, 1.0)
        err = om_ref - om
        integ = np.clip(integ + err * dt, -5, 5)
        Cu = np.clip(c_charge + J_ROT * (Kw * err + Ki * integ), -C_FREIN,
                     couple_max_rapide(om, VDC_NOM - 40))
        if t >= t_panne + retard:
            # mise en court-circuit actif : le MSAP freine comme une génératrice en court-circuit
            c_cc, i_cc = court_circuit(om[moteur])
            Cu[moteur] = -c_cc - couple_pertes(om[moteur])
        elif t >= t_panne:
            Cu[moteur] = -couple_pertes(om[moteur])          # perte de commande : roue libre
        pf = point_fonctionnement(om, Cu, VDC_NOM - 40)
        if t >= t_panne:
            pf["i_rms"][moteur] = i_cc / np.sqrt(2) if t >= t_panne + retard else 0.0
        om = np.maximum(om + dt * (Cu - c_charge) / J_ROT, 0)
        az = (poussee(om).sum() - POIDS - 0.5 * RHO * 6.0 * vz * abs(vz)) / M
        vz += az * dt; z += vz * dt
        if k % 10 == 0:
            S["t"].append(t); S["h"].append(z); S["rpm"].append(om * RPM)
            S["couple"].append(Cu.copy()); S["i_rms"].append(pf["i_rms"].copy())
            S["p_tot"].append(pf["p_dc"].sum() / 1000)
    S = {k: np.round(np.array(v), 3) for k, v in S.items()}
    S["T_nom"] = allocation(np.ones(N_ROT)); S["T_panne"] = allocation(actifs)
    return S


# =============================================================================
# 7. FIGURES
# =============================================================================
plt.rcParams.update({"figure.dpi": 130, "font.size": 10, "axes.grid": True, "grid.alpha": .3,
                     "axes.spines.top": False, "axes.spines.right": False})
C1, C2, C3, C4, C5 = "#1f77b4", "#e4572e", "#2a9d8f", "#9b5de5", "#f4a261"


def sauver(fig, nom):
    fig.tight_layout()
    fig.savefig(os.path.join(DOSSIER_FIG, nom), bbox_inches="tight")
    plt.close(fig)
    print("  figure :", nom)


def courbes_comparaison():
    """Caractéristiques couple-vitesse normalisées MCC / MAS / MS (cours)."""
    C = np.linspace(0, 1.6, 200)
    mcc = 1 - 0.08 * C                                     # MCC excitation séparée : droite
    s = np.linspace(1e-4, 1, 400); sk = 0.18               # MAS : formule de Kloss
    mas_C = 2 * 2.5 / (s / sk + sk / s)                    # Cmax = 2.5 x Cnominal
    mas_n = 1 - s
    ms_C = np.linspace(0, 1.5, 50)                          # MS : vitesse = synchronisme
    return dict(mcc_C=C.tolist(), mcc_n=mcc.tolist(), mas_C=mas_C.tolist(), mas_n=mas_n.tolist(),
                ms_C=ms_C.tolist(), ms_n=np.ones_like(ms_C).tolist(), ms_decrochage=1.5)


def main():
    print("== Points clés ==")
    print(f"  Poussée par rotor en stationnaire : {T_STAT:.0f} N  ({T_STAT/G:.0f} kgf)")
    print(f"  Vitesse rotor stationnaire       : {W_STAT*RPM:.0f} tr/min")
    print(f"  Couple / puissance par moteur    : {C_STAT:.1f} N.m / {P_ROT_STAT/1000:.1f} kW")
    print(f"  Courant crête / rendement moteur : {PF_STAT['i']:.0f} A / {PF_STAT['eta']*100:.1f} %")
    print(f"  Poussée max {T_MAXI:.0f} N : {W_MAXI*RPM:.0f} tr/min, {C_MAXI:.0f} N.m, "
          f"{C_MAXI*W_MAXI/1000:.1f} kW")

    # --- Rotor ---
    w = np.linspace(0, 2600, 200) / RPM
    rot = dict(rpm=(w * RPM).tolist(), T=poussee(w).tolist(), P=(puissance_rotor(w) / 1000).tolist(),
               C=(puissance_rotor(w) / np.maximum(w, 1)).tolist())
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(rot["rpm"], np.array(rot["T"]) / G, color=C1, lw=2, label="Poussée (kgf)")
    ax.set_xlabel("Vitesse du rotor (tr/min)"); ax.set_ylabel("Poussée (kgf)", color=C1)
    ax2 = ax.twinx(); ax2.plot(rot["rpm"], rot["P"], color=C2, lw=2, label="Puissance (kW)")
    ax2.set_ylabel("Puissance mécanique (kW)", color=C2); ax2.grid(False)
    ax.axvline(W_STAT * RPM, color="gray", ls="--"); ax.text(W_STAT * RPM + 20, 20, "Vol stationnaire")
    ax.axvline(W_MAXI * RPM, color="gray", ls=":"); ax.text(W_MAXI * RPM + 20, 20, "Poussée max")
    ax.set_title("Rotor Ø2 m : poussée ∝ Ω²   puissance ∝ Ω³")
    sauver(fig, "fig02_rotor_poussee_puissance.png")

    # --- Comparaison MCC / MAS / MS ---
    comp = courbes_comparaison()
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(comp["mcc_C"], comp["mcc_n"], color=C1, lw=2, label="MCC : n = (U − RI)/KΦ")
    ax.plot(comp["mas_C"], comp["mas_n"], color=C3, lw=2, label="MAS : glissement g")
    ax.plot(comp["ms_C"], comp["ms_n"], color=C2, lw=3, label="MS : n = f/p (synchronisme)")
    ax.plot([1.5], [1], "x", color=C2, ms=12, mew=3); ax.text(1.52, 1.01, "décrochage")
    ax.set_xlabel("Couple / couple nominal"); ax.set_ylabel("Vitesse / vitesse de synchronisme")
    ax.set_ylim(0, 1.15); ax.set_xlim(0, 2.6); ax.legend(loc="lower left")
    ax.set_title("Caractéristiques mécaniques n = f(C)")
    sauver(fig, "fig01_comparaison_MCC_MAS_MS.png")

    # --- Enveloppe couple-vitesse ---
    wv = np.linspace(1, 3600, 180) / RPM
    env = {}
    for nom, soc in [("plein", 1.0), ("faible", 0.15)]:
        vdc = tension_vide_batterie(soc) - 40
        cm = couple_max(wv, vdc)
        env[nom] = dict(vdc=float(vdc), rpm=(wv * RPM).tolist(), C=cm.tolist(), P=(cm * wv / 1000).tolist())
    charge = puissance_rotor(wv) / wv
    fig, ax = plt.subplots(figsize=(7.5, 4.3))
    ax.plot(env["plein"]["rpm"], env["plein"]["C"], color=C1, lw=2.5, label=f"Couple max (batterie pleine, {env['plein']['vdc']:.0f} V)")
    ax.plot(env["faible"]["rpm"], env["faible"]["C"], color=C1, lw=1.5, ls="--", label=f"Couple max (batterie 15 %, {env['faible']['vdc']:.0f} V)")
    ax.plot(wv * RPM, charge, color=C3, lw=2, label="Couple résistant du rotor ∝ Ω²")
    ax.plot(W_STAT * RPM, C_STAT, "o", color=C2, ms=9, label="Vol stationnaire")
    ax.plot(W_MAXI * RPM, C_MAXI, "s", color=C4, ms=9, label="Poussée max (×2)")
    ax2 = ax.twinx(); ax2.plot(env["plein"]["rpm"], env["plein"]["P"], color=C5, lw=1.5, label="Puissance max")
    ax2.set_ylabel("Puissance (kW)", color=C5); ax2.grid(False); ax2.set_ylim(0, 70)
    ax.set_xlabel("Vitesse (tr/min)"); ax.set_ylabel("Couple (N.m)"); ax.set_ylim(0, 320)
    ax.legend(loc="upper left", fontsize=8); ax.set_title("MSAP : enveloppe couple-vitesse et points de fonctionnement")
    sauver(fig, "fig03_enveloppe_couple_vitesse.png")

    # --- Carte de rendement ---
    gw = np.linspace(50, 2700, 110) / RPM
    gc = np.linspace(2, 300, 100)
    WW, CC = np.meshgrid(gw, gc)
    pf = point_fonctionnement(WW, CC, VDC_NOM - 40)
    cm = couple_max(gw, VDC_NOM - 40)
    eta = np.where(CC <= cm[None, :], pf["eta"] * 100, np.nan)
    fig, ax = plt.subplots(figsize=(7.5, 4.5))
    cs = ax.contourf(WW * RPM, CC, eta, levels=[50, 70, 80, 85, 88, 90, 92, 93, 94, 95, 96, 97], cmap="viridis")
    ax.contour(WW * RPM, CC, eta, levels=[90, 94, 96], colors="white", linewidths=.6)
    fig.colorbar(cs, label="Rendement (%)")
    ax.plot(gw * RPM, cm, "k", lw=2)
    ax.plot(gw * RPM, puissance_rotor(gw) / gw, color="white", ls="--", lw=1.5)
    ax.plot(W_STAT * RPM, C_STAT, "o", color=C2, ms=9, mec="white")
    ax.annotate(f"Stationnaire\nη = {PF_STAT['eta']*100:.1f} %", (W_STAT * RPM, C_STAT), (W_STAT * RPM - 900, C_STAT + 80),
                color="white", arrowprops=dict(color="white", arrowstyle="->"))
    ax.set_xlabel("Vitesse (tr/min)"); ax.set_ylabel("Couple (N.m)"); ax.grid(False); ax.set_ylim(0, 300)
    ax.set_title("Carte de rendement du moteur synchrone")
    sauver(fig, "fig04_carte_rendement.png")
    carte = dict(rpm=(gw * RPM).round(1).tolist(), C=gc.round(1).tolist(),
                 eta=[[None if np.isnan(v) else round(float(v), 2) for v in row] for row in eta],
                 C_max=cm.round(2).tolist())

    # --- Bilan de puissance ---
    fig, ax = plt.subplots(figsize=(7.5, 3.8))
    etapes = [("Batterie\n(DC)", bilan["p_dc"]), ("Onduleur", -bilan["p_ond"]), ("Pertes Joule\nRI²", -bilan["p_cu"]),
              ("Pertes fer", -bilan["p_fer"]), ("Pertes méca", -bilan["p_meca"]), ("Puissance\nutile", bilan["p_u"])]
    cum = 0
    for i, (nom, v) in enumerate(etapes):
        if i == 0 or i == len(etapes) - 1:
            ax.bar(i, v / 1000, color=C1 if i == 0 else C3); cum = v
        else:
            ax.bar(i, v / 1000, bottom=cum / 1000, color=C2); cum += v
        ax.text(i, abs(v) / 1000 + (0 if i in (0, len(etapes) - 1) else cum / 1000) + .3, f"{abs(v):.0f} W", ha="center", fontsize=8)
    ax.set_xticks(range(len(etapes))); ax.set_xticklabels([e[0] for e in etapes], fontsize=8)
    ax.set_ylim(0, 24); ax.set_ylabel("Puissance (kW)"); ax.set_title(f"Bilan de puissance d'un moteur en vol stationnaire (η moteur = {PF_STAT['eta']*100:.1f} %)")
    sauver(fig, "fig07_bilan_puissance.png")

    # --- Mission ---
    print("== Simulation de la mission ==")
    mis = simuler_mission()
    print(f"  Énergie consommée : {mis['energie_kWh']:.1f} kWh, SOC final {mis['soc'][-1]:.0f} %, "
          f"T° max bobinage {mis['temp'].max():.0f} °C, P max {mis['p_total'].max():.0f} kW")
    t = mis["t"] / 60
    fig, axs = plt.subplots(3, 2, figsize=(11, 8), sharex=True)
    axs[0, 0].plot(t, mis["h"], color=C1, lw=2, label="altitude"); axs[0, 0].plot(t, mis["h_ref"], "k--", lw=.8, label="consigne")
    axs[0, 0].set_ylabel("Altitude (m)"); a2 = axs[0, 0].twinx(); a2.plot(t, mis["V"], color=C5); a2.set_ylabel("Vitesse (km/h)", color=C5); a2.grid(False)
    axs[0, 1].plot(t, mis["rpm"], color=C4); axs[0, 1].set_ylabel("Vitesse moteur (tr/min)")
    axs[1, 0].plot(t, mis["couple"], color=C2); axs[1, 0].set_ylabel("Couple moteur (N.m)")
    axs[1, 1].plot(t, mis["i_rms"], color=C3); axs[1, 1].set_ylabel("Courant de phase eff. (A)")
    axs[2, 0].plot(t, mis["p_total"], color=C1); axs[2, 0].set_ylabel("Puissance batterie (kW)")
    axs[2, 1].plot(t, mis["soc"], color=C3, label="SOC (%)"); axs[2, 1].plot(t, mis["temp"], color=C2, label="T° bobinage (°C)")
    axs[2, 1].legend(); axs[2, 0].set_xlabel("Temps (min)"); axs[2, 1].set_xlabel("Temps (min)")
    fig.suptitle("Mission : aéroport → centre-ville (20 km)")
    sauver(fig, "fig05_mission.png")

    # --- Panne ---
    print("== Simulation de la panne moteur ==")
    pan = simuler_panne()
    print("  Poussées nominales (N):", pan["T_nom"].round(0))
    print("  Poussées après panne (N):", pan["T_panne"].round(0))
    print(f"  Chute d'altitude : {30 - pan['h'].min():.2f} m, couple max {pan['couple'].max():.0f} N.m, "
          f"courant max {pan['i_rms'].max():.0f} A eff.")
    fig, axs = plt.subplots(1, 3, figsize=(12, 3.8))
    k = np.arange(1, N_ROT + 1)
    axs[0].bar(k - .2, pan["T_nom"] / G, .4, color=C1, label="nominal")
    axs[0].bar(k + .2, pan["T_panne"] / G, .4, color=C2, label="moteur 1 en panne")
    axs[0].set_xlabel("Moteur n°"); axs[0].set_ylabel("Poussée (kgf)"); axs[0].legend(fontsize=8)
    for i in range(N_ROT):
        axs[1].plot(pan["t"], pan["rpm"][:, i], lw=1.2, label=f"M{i+1}")
    axs[1].set_xlabel("Temps (s)"); axs[1].set_ylabel("Vitesse (tr/min)"); axs[1].legend(fontsize=6, ncol=2)
    axs[2].plot(pan["t"], pan["h"], color=C1); axs[2].set_xlabel("Temps (s)"); axs[2].set_ylabel("Altitude (m)")
    fig.suptitle("Panne du moteur 1 en vol stationnaire à 30 m")
    sauver(fig, "fig06_panne_moteur.png")

    # --- Export pour la présentation web ---
    def L(a):
        return np.round(np.asarray(a, float), 3).tolist()
    data = dict(
        params=dict(M=M, N_ROT=N_ROT, D=D, R_BRAS=R_BRAS, CT=CT, CP=CP, RHO=RHO, G=G, KAPPA=KAPPA,
                    P_POLES=P_POLES, LAMBDA=LAMBDA, RS=RS, LS=LS, I_MAX=I_MAX, C_MAX=C_MAX, P_MAX=P_MAX,
                    K_HYST=K_HYST, K_FOUC=K_FOUC, C_FROT=C_FROT, ETA_OND=ETA_OND, KT=KT, E_BAT=E_BAT,
                    N_SERIE=N_SERIE, VDC_NOM=VDC_NOM, M_MOTEUR=M_MOTEUR, P_AUX=P_AUX),
        cles=dict(T_stat=T_STAT, rpm_stat=W_STAT * RPM, C_stat=C_STAT, P_stat=P_ROT_STAT, I_stat=float(PF_STAT["i_rms"]),
                  eta_stat=float(PF_STAT["eta"]), f_stat=float(PF_STAT["f"]), T_maxi=T_MAXI, rpm_maxi=W_MAXI * RPM,
                  C_maxi=C_MAXI, P_maxi=C_MAXI * W_MAXI, P_total_stat=N_ROT * float(PF_STAT["p_dc"]) + P_AUX,
                  energie_mission=mis["energie_kWh"], soc_fin=float(mis["soc"][-1]), temp_max=float(mis["temp"].max()),
                  chute_panne=float(30 - pan["h"].min())),
        bilan=bilan, rotor=rot, comparaison=comp, enveloppe=env,
        charge=dict(rpm=L(wv * RPM), C=L(charge)), carte=carte,
        mission={k: L(v) for k, v in mis.items() if k != "energie_kWh"},
        panne=dict(t=L(pan["t"]), h=L(pan["h"]), rpm=L(pan["rpm"].T), couple=L(pan["couple"].T),
                   i_rms=L(pan["i_rms"].T), p_tot=L(pan["p_tot"]), T_nom=L(pan["T_nom"]), T_panne=L(pan["T_panne"])),
    )
    with open(FICHIER_WEB, "w", encoding="utf-8") as f:
        f.write("// Généré par simulation/simulation_evtol.py — ne pas modifier à la main\n")
        f.write("window.SIM = " + json.dumps(data, separators=(",", ":"), allow_nan=False) + ";\n")
    print("  données web :", FICHIER_WEB, f"({os.path.getsize(FICHIER_WEB)//1024} ko)")


if __name__ == "__main__":
    main()
