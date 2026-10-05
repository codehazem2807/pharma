/* ============================================================
   Refad ERP - Chat Helper
   Version: 1.0.0
   Dependencies: refad-core.js
   ============================================================ */

(function (global) {
  'use strict';

  if (!global.Refad) {
    console.error('[Refad] Core is required before chat module');
    return;
  }

  const Chat = {
    version: '1.0.0',

    async getUnreadCount(userId) {
      try {
        const parts = await Refad.db.select('chat_participants', {
          columns: 'conversation_id, last_read_at',
          eq: { user_id: userId }
        });
        if (!parts.length) return 0;

        const convIds = parts.map(p => p.conversation_id);
        const msgs = await Refad.db.select('chat_messages', {
          columns: 'id, conversation_id, sender_id, created_at',
          in: { conversation_id: convIds },
          order: { column: 'created_at', ascending: false },
          limit: 500
        });

        const readMap = {};
        parts.forEach(p => { readMap[p.conversation_id] = p.last_read_at; });

        let count = 0;
        msgs.forEach(m => {
          if (m.sender_id === userId) return;
          const readAt = readMap[m.conversation_id];
          if (!readAt || new Date(m.created_at) > new Date(readAt)) count++;
        });
        return count;
      } catch (e) {
        console.warn('[Refad.Chat] getUnreadCount failed:', e);
        return 0;
      }
    },

    async getLastMessages(convIds) {
      if (!convIds || !convIds.length) return {};
      try {
        const msgs = await Refad.db.select('chat_messages', {
          columns: 'id, conversation_id, sender_id, content, message_type, created_at',
          in: { conversation_id: convIds },
          order: { column: 'created_at', ascending: false },
          limit: 500
        });
        const map = {};
        msgs.forEach(m => { if (!map[m.conversation_id]) map[m.conversation_id] = m; });
        return map;
      } catch (e) {
        console.warn('[Refad.Chat] getLastMessages failed:', e);
        return {};
      }
    },

    async getOrCreateDirect(myUserId, otherUserId, companyId) {
      try {
        const myParts = await Refad.db.select('chat_participants', {
          columns: 'conversation_id',
          eq: { user_id: myUserId }
        });
        const myConvIds = myParts.map(p => p.conversation_id);

        if (myConvIds.length) {
          const convs = await Refad.db.select('chat_conversations', {
            columns: 'id, type',
            in: { id: myConvIds },
            eq: { type: 'direct' }
          });
          const directIds = convs.map(c => c.id);

          if (directIds.length) {
            const parts = await Refad.db.select('chat_participants', {
              columns: 'conversation_id, user_id',
              in: { conversation_id: directIds }
            });
            const grouped = {};
            parts.forEach(p => {
              if (!grouped[p.conversation_id]) grouped[p.conversation_id] = [];
              grouped[p.conversation_id].push(p.user_id);
            });
            for (const cid of Object.keys(grouped)) {
              const users = grouped[cid];
              if (users.length === 2 && users.includes(myUserId) && users.includes(otherUserId)) {
                return { id: parseInt(cid, 10), existing: true };
              }
            }
          }
        }

        const conv = await Refad.db.insert('chat_conversations', {
          company_id: companyId,
          type: 'direct',
          created_by: myUserId,
          last_message_at: new Date().toISOString()
        });
        await Refad.db.insert('chat_participants', {
          conversation_id: conv.id, user_id: myUserId, last_read_at: new Date().toISOString()
        });
        await Refad.db.insert('chat_participants', {
          conversation_id: conv.id, user_id: otherUserId, last_read_at: null
        });
        return { id: conv.id, existing: false };
      } catch (e) {
        console.error('[Refad.Chat] getOrCreateDirect failed:', e);
        throw e;
      }
    },

    async sendText(convId, senderId, content) {
      if (!convId || !senderId || !content?.trim()) throw new Error('بيانات ناقصة');
      const trimmed = content.trim();
      if (trimmed.length > 2000) throw new Error('الرسالة طويلة جداً (الحد 2000 حرف)');

      const msg = await Refad.db.insert('chat_messages', {
        conversation_id: convId,
        sender_id: senderId,
        content: trimmed,
        message_type: 'text'
      });
      try {
        await Refad.db.update('chat_conversations', convId, {
          last_message_at: new Date().toISOString()
        });
      } catch (e) {}
      return msg;
    },

    async sendFile(convId, senderId, file) {
      if (!file) throw new Error('لم يتم اختيار ملف');
      if (file.size > 10 * 1024 * 1024) throw new Error('حجم الملف أكبر من 10 ميجا');

      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `conv-${convId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      let fileUrl = null;
      try {
        const { data, error } = await Refad.sb.storage
          .from('chat-files')
          .upload(path, file, { upsert: false, contentType: file.type });
        if (error) throw error;
        const { data: urlData } = Refad.sb.storage.from('chat-files').getPublicUrl(data.path);
        fileUrl = urlData.publicUrl;
      } catch (e) {
        console.warn('[Refad.Chat] storage upload failed, fallback to dataURL:', e.message);
        fileUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      }

      const msg = await Refad.db.insert('chat_messages', {
        conversation_id: convId,
        sender_id: senderId,
        content: file.name,
        message_type: 'file'
      });

      await Refad.db.insert('chat_files', {
        message_id: msg.id,
        file_url: fileUrl,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type
      });

      try {
        await Refad.db.update('chat_conversations', convId, {
          last_message_at: new Date().toISOString()
        });
      } catch (e) {}

      return { message: msg, file_url: fileUrl };
    },

    async markRead(convId, userId) {
      try {
        const parts = await Refad.db.select('chat_participants', {
          columns: 'id',
          eq: { conversation_id: convId, user_id: userId },
          limit: 1
        });
        if (parts.length) {
          await Refad.db.update('chat_participants', parts[0].id, {
            last_read_at: new Date().toISOString()
          });
          return true;
        }
      } catch (e) {
        console.warn('[Refad.Chat] markRead failed:', e);
      }
      return false;
    },

    subscribeConversation(convId, onMessage) {
      try {
        const channel = Refad.sb
          .channel('chat-conv-' + convId)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `conversation_id=eq.${convId}`
          }, (payload) => onMessage?.(payload.new))
          .subscribe();
        return channel;
      } catch (e) {
        console.warn('[Refad.Chat] subscribe failed:', e);
        return null;
      }
    },

    unsubscribe(channel) {
      if (!channel) return;
      try { Refad.sb.removeChannel(channel); } catch (e) {}
    },

    truncate(text, max) {
      max = max || 60;
      if (!text) return '';
      return text.length > max ? text.slice(0, max) + '...' : text;
    },

    async updateSidebarBadge(userId) {
      try {
        const badge = document.getElementById('sidebarChatBadge');
        if (!badge) return;
        const count = await Chat.getUnreadCount(userId);
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : count;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      } catch (e) {}
    }
  };

  global.Refad.Chat = Chat;
  console.log('%c[Refad] Chat v' + Chat.version + ' loaded', 'color:#8b5cf6;font-weight:bold');

})(typeof window !== 'undefined' ? window : this);