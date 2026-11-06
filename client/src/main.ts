import { createApp, defineAsyncComponent } from "vue";
import "./style.css";

const isAdmin = location.pathname.startsWith("/admin");
const Root = isAdmin
  ? defineAsyncComponent(() => import("./admin/AdminApp.vue"))
  : defineAsyncComponent(() => import("./GameApp.vue"));

document.documentElement.dataset.view = isAdmin ? "admin" : "game";
createApp(Root).mount("#app");
