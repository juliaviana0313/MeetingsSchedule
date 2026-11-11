# MeetingSchedule workspace

The application in `meeting-dashboard/` is a shared public scheduling dashboard. Visitors book meetings with Travis Ruiz (`hello@truemarch.fun`) by entering only their own name and email without registering or connecting a Cal.com account. The backend uses the Cal.com API key for `hello@truemarch.fun`, supplied through server environment settings.

**Website:** https://meetingschedule-hub-nov26.dragonwarrior9873.chatgpt.site

- [How booking works](meeting-dashboard/README.md#how-the-booking-works)
- [Server environment setup](meeting-dashboard/README.md#server-environment-setup)
- [Public API boundaries](meeting-dashboard/README.md#public-api-boundaries)
- [Troubleshooting](meeting-dashboard/README.md#troubleshooting)
- [Verification](meeting-dashboard/README.md#verification)

Navigation is in the left sidebar. Light and dark modes are available at the top of the page. Visitors can create/edit public events, set availability schedules, book meetings with an explicitly selected meeting format, reschedule or cancel reservations, and view cancellations. All actions use the server-side API key; visitors never enter or receive it. See the application README for shared-workspace visibility and supported operations.
